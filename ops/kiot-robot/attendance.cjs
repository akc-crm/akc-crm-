const fs = require('node:fs/promises');
const path = require('node:path');

const dayNames = ['Chủ nhật','Thứ hai','Thứ ba','Thứ tư','Thứ năm','Thứ sáu','Thứ bảy'];
const dayPattern = /Thứ hai|Thứ ba|Thứ tư|Thứ năm|Thứ sáu|Thứ bảy|Chủ nhật/g;
const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const visibleText = (page, text) => page.getByText(text, {exact:true}).filter({visible:true});
const dateLabel = date => date.slice(8,10) + '/' + date.slice(5,7) + '/' + date.slice(0,4);
const normalizedName = name => name.normalize('NFC').trim().replace(/\s+/g,' ').toLocaleLowerCase('vi-VN');
const employeePattern = name => new RegExp('^\\s*'+name.trim().split(/\s+/).map(escape).join('\\s+')+'\\s*$','iu');
const optionPattern = (name, code) => new RegExp('^\\s*'+name.trim().split(/\s+/).map(escape).join('\\s+')+'\\s*'+escape(code)+'\\s*$','iu');

function assertRecordIdentity(text, job) {
  const heading=text.split('Thời gian')[0];
  const nameMatches=heading.split(/\r?\n/).some(line=>normalizedName(line)===normalizedName(job.employeeName));
  const codeMatches=new RegExp('(?:^|\\s)'+escape(job.staffCode)+'(?:\\s|$)').test(heading);
  if(!nameMatches||!codeMatches||!text.includes(dateLabel(job.work_date))) throw new Error('Sai nhân viên/ngày.');
}

function recordedStatus(text) {
  const heading = text.split('Thời gian')[0];
  const statuses = ['Chưa chấm công','Nghỉ phép hưởng lương','Nghỉ không lương','Đi muộn / Về sớm','Đúng giờ','Chấm công thiếu'];
  const found = statuses.filter(status => heading.includes(status));
  if (found.length !== 1) throw new Error('Không đọc được duy nhất trạng thái chấm công hiện tại.');
  return found[0];
}

async function loaded(page) {
  await page.waitForFunction(() => !Array.from(document.querySelectorAll('*')).some(el =>
    el.children.length === 0 && el.textContent.trim() === 'Đang tải dữ liệu' &&
    el.getClientRects().length > 0), null, {timeout:90000});
  await visibleText(page, 'Bảng chấm công').first().waitFor({timeout:60000});
}

async function headerInfo(header) {
  return header.evaluate(el => {
    let node = el;
    for (let i=0; node && i<4; i++,node=node.parentElement) {
      const text = node.innerText || '';
      if ((text.match(/Thứ hai|Thứ ba|Thứ tư|Thứ năm|Thứ sáu|Thứ bảy|Chủ nhật/g) || []).length === 1 && /\d{2}/.test(text)) return text;
    }
    throw new Error('Không đọc được ngày ở tiêu đề cột.');
  });
}

async function targetHeader(page, date) {
  const desired = new Date(date+'T12:00:00Z');
  if (desired.toISOString().slice(0,10) !== date) throw new Error('Ngày không tồn tại.');
  const month = Number(date.slice(5,7)), year = Number(date.slice(0,4)), day = Number(date.slice(8,10));
  for (let step=0;step<55;step++) {
    const label = page.getByText(/Tuần\s+\d+.*Th\.\s*\d+\s+\d{4}/).filter({visible:true}).first();
    await label.waitFor({timeout:15000});
    const title = await label.innerText();
    const period = title.match(/Th\.\s*(\d+)\s+(\d{4})/);
    if (!period) throw new Error('Không đọc được tháng/năm của bảng.');
    const shownMonth=Number(period[1]), shownYear=Number(period[2]);
    const header = visibleText(page, new RegExp(dayNames[desired.getUTCDay()]));
    if (await header.count() !== 1) throw new Error('Không xác định duy nhất cột ngày.');
    const text=await headerInfo(header);
    const headerDay=Number(text.match(/\d{2}/)?.[0]);
    if (shownMonth===month && shownYear===year && headerDay===day && (text.match(dayPattern)||[]).length===1) return header;
    const monday = Number((await headerInfo(visibleText(page,/Thứ hai/))).match(/\d{2}/)?.[0]);
    const sunday = Number((await headerInfo(visibleText(page,/Chủ nhật/))).match(/\d{2}/)?.[0]);
    // Cross-month weeks are deliberately stopped: a day number alone cannot
    // establish its full date. The modal also validates the date before any write.
    if (shownMonth===month && shownYear===year && sunday < monday) throw new Error('Tuần giao tháng cần kiểm tra lịch; chưa ghi Kiot.');
    const direction = (year*12+month !== shownYear*12+shownMonth)
      ? Math.sign(year*12+month-shownYear*12-shownMonth) : (day<monday ? -1 : 1);
    const calendar=page.locator('.ts-header-filter-calendar').filter({visible:true});
    if(await calendar.count()!==1) throw new Error('Không xác định duy nhất cụm chuyển tuần.');
    const arrow=calendar.locator(direction<0 ? 'a#prev-btn' : 'a#next-btn').filter({visible:true});
    if(await arrow.count()!==1) throw new Error('Không xác định duy nhất nút chuyển tuần.');
    const before = await headerInfo(visibleText(page,/Thứ hai/));
    await arrow.click();
    await page.waitForTimeout(1500);
    await loaded(page);
    if ((await label.innerText())===title && (await headerInfo(visibleText(page,/Thứ hai/)))===before) throw new Error('Bảng chưa chuyển tuần; chưa ghi Kiot.');
  }
  throw new Error('Ngày nghỉ cách lịch hiện tại quá xa.');
}

async function locateForm(page, job) {
  const id=visibleText(page,job.staffCode).last();
  await id.waitFor({timeout:15000});
  await id.evaluate((el, fullDate) => {
    document.querySelectorAll('[data-akc-attendance-form]').forEach(n=>n.removeAttribute('data-akc-attendance-form'));
    for(let node=el;node&&node!==document.body;node=node.parentElement) {
      const text=node.innerText||'';
      const saves=Array.from(node.querySelectorAll('button')).filter(b=>b.innerText.trim()==='Lưu');
      if(text.includes(fullDate)&&text.includes('Ca làm việc')&&text.includes('Đi làm')&&saves.length===1) {
        node.setAttribute('data-akc-attendance-form','active'); return;
      }
    }
    throw new Error('Hộp chấm công không khớp ngày/nhân viên.');
  },dateLabel(job.work_date));
  const form=page.locator('[data-akc-attendance-form="active"]');
  const text=await form.innerText();
  assertRecordIdentity(text,job);
  const shift=text.match(/Ca\s+\d+\s*\(\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\)/)?.[0];
  if(!shift) throw new Error('Không đọc được ca đã xếp.');
  return {form,text,shift,status:recordedStatus(text)};
}

async function openRecord(browser, config, job) {
  const context=await browser.newContext({storageState:path.join(__dirname,'session.json'),locale:'vi-VN',timezoneId:'Asia/Ho_Chi_Minh'});
  const page=await context.newPage();
  try {
    page.setDefaultTimeout(20000);
    await page.goto('https://akcfitness.kiotviet.vn/man/#/TimeSheet',{waitUntil:'domcontentloaded',timeout:60000});
    await loaded(page);
    const branch=visibleText(page,job.branchName);
    if (!(await branch.count())) {
      const current=page.getByText(/^AKC Fitness\s/).filter({visible:true});
      if(await current.count()!==1) throw new Error('Không xác định được cơ sở hiện tại.');
      await current.click(); await branch.last().click();
      await page.waitForTimeout(5000); await loaded(page);
    }
    await branch.first().waitFor({timeout:20000});
    const search=page.getByPlaceholder('Tìm kiếm nhân viên',{exact:true}).filter({visible:true}).first();
    await search.fill(job.employeeName); await search.press('ArrowDown');
    const option=page.getByRole('option',{name:optionPattern(job.employeeName,job.staffCode)}).filter({visible:true});
    await option.waitFor({timeout:20000});
    await option.click(); await page.keyboard.press('Escape');
    await page.waitForTimeout(1500); await loaded(page);
    const header=await targetHeader(page,job.work_date);
    const column=await header.boundingBox();
    if(!column) throw new Error('Không đọc được cột ngày.');
    const names=visibleText(page,employeePattern(job.employeeName));
    const matches=[];
    for(let i=0;i<await names.count();i++) {
      const box=await names.nth(i).boundingBox();
      if(box&&box.y>column.y+column.height&&box.x<column.x+column.width&&box.x+box.width>column.x) matches.push(i);
    }
    if(!matches.length) { await context.close(); return {no_shift:true}; }
    if(matches.length!==1) throw new Error('Có nhiều ca trong ngày; cần kiểm tra trước khi ghi.');
    // A single click first avoids creating stacked dialogs with dblclick.
    await names.nth(matches[0]).click();
    try { await visibleText(page,job.staffCode).last().waitFor({timeout:3000}); }
    catch { await names.nth(matches[0]).click(); }
    const record=await locateForm(page,job);
    return {...record,page,context};
  } catch(error) {
    await page.screenshot({path:path.join(__dirname,'robot-error.png'),mask:[page.locator('input')]}).catch(()=>{});
    await fs.chmod(path.join(__dirname,'robot-error.png'),0o600).catch(()=>{});
    await context.close(); throw error;
  }
}

async function syncAttendance(job, config) {
  const {chromium} = require('playwright');
  const browser=await chromium.launch({headless:true});
  const deadline=setTimeout(()=>browser.close().catch(()=>{}),7*60*1000);
  try {
    const initial=await openRecord(browser,config,job);
    if(initial.no_shift) {
      const confirm=await openRecord(browser,config,job);
      if(!confirm.no_shift) throw new Error('Lần đọc đầu chưa tải đủ ca. Chưa ghi Kiot; cần thử lại.');
      return {outcome:'skipped_no_shift',work_date:job.work_date};
    }
    const {form,context,status,shift}=initial;
    if(status===job.attendance_type) { await context.close(); return {outcome:'already_applied',work_date:job.work_date,status,shift}; }
    if(status!=='Chưa chấm công') throw new Error('Đã có chấm công/nghỉ khác: '+status+'. Không ghi đè.');
    const checks=form.locator('input[type="checkbox"]');
    if(await checks.count()!==2) throw new Error('Không đọc được hai ô Vào/Ra.');
    if(await checks.nth(0).isChecked()||await checks.nth(1).isChecked()) throw new Error('Đã có giờ vào/ra. Không ghi đè.');
    if(config.write_enabled!==true) { await context.close(); return {outcome:'preview',work_date:job.work_date,before:status,planned:job.attendance_type,shift}; }
    await form.getByText(job.attendance_type,{exact:true}).last().click();
    await form.getByRole('button',{name:'Lưu',exact:true}).click();
    await form.waitFor({state:'hidden',timeout:30000});
    await context.close();
    // Read back from a fresh context: remaining duplicate dialogs can be stale.
    const after=await openRecord(browser,config,job);
    if(after.no_shift||after.status!==job.attendance_type||after.shift!==shift) throw new Error('Đã bấm Lưu nhưng đọc lại chưa xác nhận đúng trạng thái/ca.');
    await after.context.close();
    return {outcome:'saved_and_verified',work_date:job.work_date,status:after.status,shift,staff_code:job.staffCode,branch:job.branchName};
  } finally { clearTimeout(deadline); await browser.close(); }
}
module.exports={syncAttendance,recordedStatus,dateLabel,targetHeader,employeePattern,optionPattern,assertRecordIdentity};

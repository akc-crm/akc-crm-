const fs=require('node:fs/promises');
const path=require('node:path');
const {targetHeader,employeePattern,optionPattern,loaded,locateForm,visibleText}=require('./attendance.cjs');

function shiftPattern(shift){
 const escaped=shift.replace(/[.*+?^${}()|[\]\\]/g,'\\$&').replace(/\s+/g,'\\s*');
 return new RegExp('^\\s*'+escaped+'\\s*$','iu');
}

async function selectBranchAndEmployee(page,job){
 await page.goto('https://akcfitness.kiotviet.vn/man/#/TimeSheet',{waitUntil:'domcontentloaded',timeout:60000});
 await loaded(page);
 const branch=visibleText(page,job.branchName);
 if(!(await branch.count())){
  const current=page.getByText(/^AKC Fitness\s/).filter({visible:true});
  if(await current.count()!==1)throw new Error('Không xác định được cơ sở hiện tại.');
  await current.click();await branch.last().click();await page.waitForTimeout(5000);await loaded(page);
 }
 const search=page.getByPlaceholder('Tìm kiếm nhân viên',{exact:true}).filter({visible:true}).first();
 await search.fill(job.employeeName);await search.press('ArrowDown');
 const option=page.getByRole('option',{name:optionPattern(job.employeeName,job.staffCode)}).filter({visible:true});
 await option.waitFor({timeout:20000});await option.click();await page.keyboard.press('Escape');
 await page.waitForTimeout(1200);await loaded(page);
}

async function namesInDateColumn(page,header,employeeName){
 const column=await header.boundingBox();if(!column)throw new Error('Không đọc được cột ngày.');
 const names=visibleText(page,employeePattern(employeeName));const matches=[];
 for(let i=0;i<await names.count();i++){
  const box=await names.nth(i).boundingBox();
  if(box&&box.y>column.y+column.height&&box.x<column.x+column.width&&box.x+box.width>column.x)matches.push(names.nth(i));
 }
 return matches;
}

async function readScheduledShift(page,job,date){
 const header=await targetHeader(page,date);const matches=await namesInDateColumn(page,header,job.employeeName);
 if(!matches.length)return {header,no_shift:true};
 if(matches.length!==1)throw new Error('Nhân viên có nhiều ca trong ngày; cần kiểm tra thủ công.');
 await matches[0].click();
 try{await visibleText(page,job.staffCode).last().waitFor({timeout:3000});}catch{await matches[0].click();}
 const record=await locateForm(page,{...job,work_date:date});
 const checks=record.form.locator('input[type="checkbox"]');
 if(record.status!=='Chưa chấm công')throw new Error('Ngày muốn nghỉ đã có chấm công/trạng thái: '+record.status+'.');
 if(await checks.count()!==2||await checks.nth(0).isChecked()||await checks.nth(1).isChecked())throw new Error('Ngày muốn nghỉ đã có giờ vào/ra.');
 await record.form.getByRole('button',{name:/Close/}).click().catch(async()=>{await page.keyboard.press('Escape')});
 return {header,no_shift:false,shift:record.shift};
}

async function cellForShiftAndDate(page,shift,date){
 const header=await targetHeader(page,date);const column=await header.boundingBox();
 if(!column)throw new Error('Không đọc được cột ngày.');
 const row=page.getByRole('row').filter({has:page.getByRole('gridcell',{name:shiftPattern(shift)})});
 if(await row.count()!==1)throw new Error('Không xác định duy nhất dòng '+shift+'.');
 const owned=String(await row.getAttribute('aria-owns')||'').split(/\s+/).filter(Boolean);
 if(!owned.length)throw new Error('Không đọc được các ô ngày của dòng '+shift+'.');
 const cells=page.locator(owned.map(id=>'#'+id).join(','));
 const matches=[];
 for(let i=0;i<await cells.count();i++){
  const box=await cells.nth(i).boundingBox();
  if(box&&box.x<column.x+column.width&&box.x+box.width>column.x)matches.push(cells.nth(i));
 }
 if(matches.length!==1)throw new Error('Không xác định duy nhất ô ca theo ngày.');
 return matches[0];
}

async function addShift(page,job,shift,date){
 const existing=await readScheduledShift(page,job,date);
 if(!existing.no_shift){if(existing.shift===shift)return 'already_added';throw new Error('Ngày nghỉ hiện tại đã có ca khác: '+existing.shift+'.');}
 const cell=await cellForShiftAndDate(page,shift,date);await cell.click();
 const modal=page.getByText(new RegExp(shift.split(' ')[0]+'\\s*\\d+.*'+date.slice(8,10)+'/'+date.slice(5,7)+'/'+date.slice(0,4))).filter({visible:true}).first();
 await modal.waitFor({timeout:10000});
 const combo=page.getByRole('combobox').filter({visible:true}).last();await combo.fill(job.employeeName);await combo.press('ArrowDown');
 const option=page.getByRole('option',{name:optionPattern(job.employeeName,job.staffCode)}).filter({visible:true});
 await option.waitFor({timeout:15000});await option.click();
 await page.getByRole('button',{name:'Đồng ý',exact:true}).filter({visible:true}).click();
 await page.waitForTimeout(1200);await loaded(page);
 const after=await readScheduledShift(page,job,date);
 if(after.no_shift||after.shift!==shift)throw new Error('Đã xếp ca nhưng đọc lại chưa xác nhận đúng ca/ngày.');
 return 'added';
}

async function removeShift(page,job,shift,date){
 const record=await readScheduledShift(page,job,date);
 if(record.no_shift)return 'already_removed';
 if(record.shift!==shift)throw new Error('Ca ngày muốn nghỉ đã thay đổi: '+record.shift+'.');
 // readScheduledShift closes the form after validating. Re-open the exact record.
 const header=await targetHeader(page,date);const matches=await namesInDateColumn(page,header,job.employeeName);
 if(matches.length!==1)throw new Error('Không tìm thấy duy nhất ca cần gỡ.');
 await matches[0].click();await visibleText(page,job.staffCode).last().waitFor({timeout:5000});
 const form=(await locateForm(page,{...job,work_date:date})).form;
 page.once('dialog',dialog=>dialog.accept());
 await form.getByRole('button',{name:/Hủy/,exact:false}).click();
 const confirm=page.getByRole('button',{name:/^(Đồng ý|Xác nhận)$/}).filter({visible:true});
 if(await confirm.count())await confirm.last().click();
 await page.waitForTimeout(1200);await loaded(page);
 const after=await readScheduledShift(page,job,date);
 if(!after.no_shift)throw new Error('Đã gỡ ca nhưng đọc lại vẫn còn lịch làm.');
 return 'removed';
}

async function syncWeeklyRestChange(job,config){
 const {chromium}=require('playwright');const browser=await chromium.launch({headless:true});
 const deadline=setTimeout(()=>browser.close().catch(()=>{}),7*60*1000);
 const context=await browser.newContext({storageState:path.join(__dirname,'session.json'),locale:'vi-VN',timezoneId:'Asia/Ho_Chi_Minh'});
 const page=await context.newPage();page.setDefaultTimeout(20000);
 try{
  await selectBranchAndEmployee(page,job);
  const source=await readScheduledShift(page,job,job.new_rest_date);
  const destination=await readScheduledShift(page,job,job.old_rest_date);
  if(source.no_shift&&destination.no_shift)throw new Error('Cả hai ngày đều không có ca; không có gì để chuyển.');
  if(source.no_shift&&!destination.no_shift)return {outcome:'already_moved',shift:destination.shift,old_rest_date:job.old_rest_date,new_rest_date:job.new_rest_date};
  if(!destination.no_shift&&destination.shift!==source.shift)throw new Error('Ngày nghỉ hiện tại đã có ca khác; không ghi đè.');
  const shift=source.shift;
  if(config.write_enabled!==true)return {outcome:'preview',shift,add_to:job.old_rest_date,remove_from:job.new_rest_date};
  const addResult=await addShift(page,job,shift,job.old_rest_date);
  // The destructive step is deliberately last. A failed add never removes the source shift.
  const removeResult=await removeShift(page,job,shift,job.new_rest_date);
  const finalOld=await readScheduledShift(page,job,job.old_rest_date);
  const finalNew=await readScheduledShift(page,job,job.new_rest_date);
  if(finalOld.no_shift||finalOld.shift!==shift||!finalNew.no_shift)throw new Error('Đọc lại chưa xác nhận đúng kết quả chuyển ca.');
  return {outcome:'shift_moved_and_verified',shift,add_result:addResult,remove_result:removeResult,
   old_rest_date:job.old_rest_date,new_rest_date:job.new_rest_date,staff_code:job.staffCode,branch:job.branchName};
 }catch(error){await page.screenshot({path:path.join(__dirname,'robot-error.png'),mask:[page.locator('input')]}).catch(()=>{});await fs.chmod(path.join(__dirname,'robot-error.png'),0o600).catch(()=>{});throw error;}
 finally{clearTimeout(deadline);await context.close().catch(()=>{});await browser.close().catch(()=>{});}
}

module.exports={syncWeeklyRestChange,shiftPattern};

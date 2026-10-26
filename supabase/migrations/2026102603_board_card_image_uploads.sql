-- Permit a PT to persist only the avatar of a card they own.
-- Managers/admins retain the same action only for cards in their accessible Board scope.
-- No existing card, comment, or image data is modified by this migration.

CREATE OR REPLACE FUNCTION public.update_board_card_cover(
  p_card_id uuid,
  p_cover_image text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.akc_profile_role();

  IF p_card_id IS NULL
     OR p_cover_image IS NULL
     OR length(p_cover_image) > 2048
     OR p_cover_image !~ '^https://kjnkbsgbomgunnmvevqs\.supabase\.co/storage/v1/object/public/card-images/' THEN
    RAISE EXCEPTION 'Ảnh đại diện không hợp lệ';
  END IF;

  IF v_role = 'pt' THEN
    UPDATE public.board_cards
       SET cover_image = p_cover_image,
           updated_at = now()
     WHERE id = p_card_id
       AND owner_id = (SELECT auth.uid());
  ELSIF v_role IN ('admin', 'manager') THEN
    UPDATE public.board_cards
       SET cover_image = p_cover_image,
           updated_at = now()
     WHERE id = p_card_id
       AND public.akc_can_access_card(id);
  ELSE
    RAISE EXCEPTION 'Bạn không có quyền cập nhật ảnh của thẻ này';
  END IF;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Không tìm thấy thẻ hoặc bạn không có quyền cập nhật ảnh';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.update_board_card_cover(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_board_card_cover(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_board_card_cover(uuid, text) TO authenticated;

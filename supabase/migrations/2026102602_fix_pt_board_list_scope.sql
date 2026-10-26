-- Correct the list-to-Board correlation in the PT card creation policy.
-- No business records are changed.

DROP POLICY IF EXISTS board_cards_create_by_pt_own_branch ON public.board_cards;
CREATE POLICY board_cards_create_by_pt_own_branch ON public.board_cards
  FOR INSERT TO authenticated
  WITH CHECK (
    public.akc_profile_role() = 'pt'
    AND created_by = (SELECT auth.uid())
    AND owner_id = (SELECT auth.uid())
    AND public.akc_can_access_board(board_id)
    AND EXISTS (
      SELECT 1
      FROM public.board_lists bl
      WHERE bl.id = list_id
        AND bl.board_id = public.board_cards.board_id
    )
    AND base_kpi_points = 30
    AND workflow_status = 'Chưa bắt đầu'
    AND COALESCE(earned_kpi_points, 0) = 0
    AND reviewer_id IS NULL
  );

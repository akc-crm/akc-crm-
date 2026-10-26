-- Permit approved PT accounts to create only their own cards and initial checklist items
-- in a Board they can already access. Existing business data is not changed.

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

DROP POLICY IF EXISTS card_checklists_create_by_pt_own_card ON public.card_checklists;
CREATE POLICY card_checklists_create_by_pt_own_card ON public.card_checklists
  FOR INSERT TO authenticated
  WITH CHECK (
    public.akc_profile_role() = 'pt'
    AND created_by = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.board_cards bc
      WHERE bc.id = card_id
        AND bc.owner_id = (SELECT auth.uid())
        AND bc.created_by = (SELECT auth.uid())
        AND public.akc_can_access_card(bc.id)
    )
  );

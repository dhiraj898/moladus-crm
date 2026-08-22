-- ---------------------------------------------------------------------------
-- Atomic field reorder (W5 — form configurator)
--
-- reorderFields previously issued one UPDATE per field over the client. A
-- partial failure could leave form_fields with a duplicated/inconsistent
-- display_order set that diverged from the UI. This function reindexes every
-- field for a form in a single transaction: it sets display_order to each id's
-- position in p_ordered_ids, scoped to p_form_id so ids from another form are
-- ignored. Called via supabase.rpc('reorder_form_fields', ...).
-- ---------------------------------------------------------------------------
create or replace function reorder_form_fields(
  p_form_id uuid,
  p_ordered_ids uuid[]
) returns void
language plpgsql
as $$
declare
  i integer;
begin
  for i in 1 .. coalesce(array_length(p_ordered_ids, 1), 0) loop
    update form_fields
      set display_order = i - 1
      where id = p_ordered_ids[i]
        and form_id = p_form_id;
  end loop;
end;
$$;

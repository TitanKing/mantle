-- pg_notify channel that fires whenever a new content `nodes` row lands.
-- The extractor agent listens on this and decides (per its memory_config)
-- whether to process the node.
--
-- Branch nodes are folders, not content — exclude at the trigger layer
-- so we never fire on those. Everything else (including types not yet
-- in the extractor's allowlist) is announced; the listener short-circuits
-- when the type isn't in its extract_types set.

create or replace function "public"."notify_node_ingested"()
  returns trigger language plpgsql as $$
begin
  if new.type is distinct from 'branch'::node_type then
    perform pg_notify('node_ingested', new.id::text);
  end if;
  return new;
end
$$;

drop trigger if exists "nodes_ingested_trg" on "public"."nodes";
create trigger "nodes_ingested_trg"
  after insert on "public"."nodes"
  for each row execute function "public"."notify_node_ingested"();

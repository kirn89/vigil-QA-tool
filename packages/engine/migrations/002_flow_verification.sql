alter table flows add column verified boolean not null default false;
alter table flows add column verification_note text;
alter table flows add column source text not null default 'manual'
  check (source in ('mapped', 'described', 'manual'));

-- Existing confirmed flows were already trusted/watched.
update flows set verified = true where status = 'confirmed';

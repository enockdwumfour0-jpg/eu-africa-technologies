-- 008: link staff/author columns to public.profiles so the API can embed names
-- (PostgREST only embeds through foreign keys; the existing ones point at auth.users).
alter table public.project_members      add constraint project_members_profile_fk      foreign key (user_id)     references public.profiles(id) on delete cascade;
alter table public.project_updates      add constraint project_updates_author_fk       foreign key (author_id)   references public.profiles(id);
alter table public.document_reviews     add constraint document_reviews_reviewer_fk    foreign key (reviewer_id) references public.profiles(id);
alter table public.project_request_notes add constraint request_notes_author_fk        foreign key (author_id)   references public.profiles(id);
alter table public.project_requests     add constraint project_requests_assignee_fk    foreign key (assigned_to) references public.profiles(id) on delete set null;
alter table public.support_tickets      add constraint support_tickets_assignee_fk     foreign key (assigned_to) references public.profiles(id) on delete set null;
create index if not exists project_updates_author_idx on public.project_updates(author_id);

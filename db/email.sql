-- =====================================================================
--  Vastra Apparel -- emails to customers (db/SETUP.md step 13)
--
--  Paste the whole file into the Supabase SQL editor, THEN change the two
--  CHANGE-ME lines there -- in the editor, never in this file: this
--  repository is public, and the key would be anybody's. Run it.
--
--    api_key  a Brevo API key: Brevo > SMTP & API > API Keys > Generate.
--             It starts with xkeysib-. (Not the SMTP key from step 7b,
--             which starts with xsmtpsib- and is refused here.)
--    sender   the address the sign-in codes already come from -- step
--             7b's sender, which Brevo has verified.
--
--  It keeps both in Supabase's Vault, encrypted, where only the database
--  reads them, and sends ONE test email to the sender address. From then
--  on the database emails each customer when their order moves, and
--  whoever asked to be told when a product is back. Run it again to
--  change the key or the address.
--
--  It refuses to run while CHANGE-ME is still there.
-- =====================================================================
do $email$
declare
  api_key   text := 'CHANGE-ME';
  sender    text := 'CHANGE-ME';
  shop_name text := 'Vastra Apparel';
  sid       uuid;
  rid       bigint;
begin
  if api_key = 'CHANGE-ME' or api_key !~ '^xkeysib-[A-Za-z0-9-]{20,}$' then
    raise exception 'NOTHING SAVED: put your Brevo API key between the quotes on the api_key line. It starts with xkeysib- (Brevo > SMTP & API > API Keys).';
  end if;
  if sender = 'CHANGE-ME' or sender !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'NOTHING SAVED: put the shop''s sender address between the quotes on the sender line -- the one the sign-in codes come from.';
  end if;
  if not exists (select 1 from pg_proc where proname = 'send_notices') then
    raise exception 'NOTHING SAVED: run schema.sql first (db/SETUP.md step 12).';
  end if;

  select id into sid from vault.secrets where name = 'vastra_brevo_key';
  if sid is null then perform vault.create_secret(api_key, 'vastra_brevo_key', 'Brevo API key, for customer emails');
  else perform vault.update_secret(sid, api_key); end if;
  select id into sid from vault.secrets where name = 'vastra_mail_from';
  if sid is null then perform vault.create_secret(sender, 'vastra_mail_from', 'The address customer emails come from');
  else perform vault.update_secret(sid, sender); end if;
  select id into sid from vault.secrets where name = 'vastra_mail_name';
  if sid is null then perform vault.create_secret(shop_name, 'vastra_mail_name', 'The name customer emails come from');
  else perform vault.update_secret(sid, shop_name); end if;

  -- One test email, to the sender, so it can be seen to work.
  rid := net.http_post(
    url := 'https://api.brevo.com/v3/smtp/email',
    body := jsonb_build_object(
      'sender', jsonb_build_object('name', shop_name, 'email', sender),
      'to', jsonb_build_array(jsonb_build_object('email', sender)),
      'subject', 'Customer emails are set up',
      'htmlContent', '<p>This is the shop''s database. From now on it emails each customer when their order moves, and whoever asked to be told when a product is back.</p>'),
    headers := jsonb_build_object('api-key', api_key, 'Content-Type', 'application/json',
                                  'Accept', 'application/json'));
  insert into notices (kind, email, subject, request_id)
  values ('test', sender, 'Customer emails are set up', rid);
end $email$;

select 'Saved. A test email is on its way to the sender address -- look in that inbox (and its spam folder) in a minute.' as result;

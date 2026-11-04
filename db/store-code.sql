-- ---------------------------------------------------------------------
--  SET THE STORE CODE. Run this once, after schema.sql.
--
--  ⚠️ EDIT THE `code :=` LINE IN THE SUPABASE SQL EDITOR, NOT IN THIS
--  FILE. This repository is public: a code typed here and committed is a
--  code anybody can read, and it opens every customer's name, phone and
--  address. tools/db.pl FAILS if this file holds anything but CHANGE-ME.
--
--  The code must be 8 to 24 lowercase letters or digits. The store page
--  trims and lowercases what is typed (a phone capitalises the first
--  letter on its own), so an uppercase code set here could never match.
--  Never a word that has been public -- the shop's name, its phone
--  number -- because those are the first things anybody would try.
--
--  Running it unchanged stops with an error instead of storing the hash
--  of the word CHANGE-ME, which would look exactly like success.
--
--  To change the code later, run this again with the new one. Phones
--  already let in stay in; see db/SETUP.md to turn one out.
-- ---------------------------------------------------------------------
do $guard$
declare code text := 'CHANGE-ME';
begin
  if code !~ '^[a-z0-9]{8,24}$' then
    raise exception
      'Set a real store code first: edit the code := line above to 8-24 lowercase letters or digits. Got "%".', code;
  end if;

  insert into shop_secret (id, code_hash)
  values (1, extensions.crypt(code, extensions.gen_salt('bf', 10)))
  on conflict (id) do update set code_hash = excluded.code_hash, set_at = now();

  raise notice 'Store code set. Type it on the store page to let that phone in.';
end
$guard$;

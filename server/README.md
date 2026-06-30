# Server SDK setup

Ten folder jest szkieletem pod przyszłą warstwę serwerową/Edge Function z
`@supabase/server`.

Obecna strona `ME_2028` nadal działa jako statyczny frontend na GitHub Pages i
łączy się z Supabase przez funkcje RPC. Tego pliku serwerowego nie wrzuca się
bezpośrednio na GitHub Pages, bo GitHub Pages nie uruchamia kodu serwerowego.

## Instalacja

W folderze `ME_2028`:

```powershell
npm install @supabase/server
```

## Zmienne środowiskowe

Skopiuj `.env.example` do `.env` tylko lokalnie albo ustaw zmienne w panelu
hostingu funkcji:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `SUPABASE_JWKS_URL`

Nie commituj prawdziwego `SUPABASE_SECRET_KEY`.

## Przykładowy handler

`me2028-handler.js` pokazuje użycie:

- `withSupabase` z `auth: "publishable"`,
- `ctx.supabaseAdmin` do odczytów administracyjnych,
- endpointów testowych `/health`, `/matches`, `/ranking`.

Przy funkcjach używających trybu innego niż `auth: "user"` trzeba ustawić
`verify_jwt = false` w konfiguracji funkcji, zgodnie z instrukcją Supabase.
W tym repo jest już dodany przykład konfiguracji:

```text
supabase/config.toml
```

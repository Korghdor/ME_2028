# BalticWood ME 2028 - prototyp z Supabase

To jest testowa wersja strony na ME 2028 przygotowana na bazie strony MS 2026.
GitHub Pages hostuje pliki strony, a Supabase przechowuje zawodników, sesje,
typy, wyniki i ranking.

## 1. Uruchomienie bazy w Supabase

1. Wejdź do projektu Supabase:
   `https://supabase.com/dashboard/project/poztffgnnrcedjkekdky`
2. Otwórz `SQL Editor`.
3. Kliknij `New query`.
4. Wklej całą zawartość pliku `supabase-schema.sql`.
5. Kliknij `Run`.

Skrypt tworzy:

- zawodników,
- mecze testowe,
- typy,
- sesje,
- funkcje logowania,
- funkcje zapisu typów i wyników,
- ranking liczony po stronie bazy,
- blokadę typowania 10 minut przed startem meczu.

## 2. Wklejenie publicznego klucza

1. W Supabase wejdź w `Project Settings`.
2. Otwórz `API`.
3. Adres API jest już wpisany w `supabase-config.js`.
4. Skopiuj `anon public key`.
5. W pliku `supabase-config.js` podmień:

```js
anonKey: "WSTAW_TUTAJ_ANON_PUBLIC_KEY",
```

na skopiowany klucz.

Nie wklejaj do strony `service_role key`. Ten klucz jest tajny.

## 3. Konta testowe

- Maciej Zając, PIN `8500`, rola `master`
- Tomasz Brocławik, PIN `1257`, rola `zawodnik`

PIN-y są haszowane w bazie przez `pgcrypto`, więc nie są zapisane w plikach strony.

## 4. Co działa

- Logowanie przez PIN.
- Typowanie wyników meczów.
- Serwerowa blokada zapisu typu, gdy do meczu zostało mniej niż 10 minut.
- Panel mastera dla Macieja Zająca.
- Wpisywanie wyników meczów przez mastera.
- Przeliczanie rankingu po stronie bazy.
- Ranking z punktami, dokładnymi wynikami i dobrze wytypowanym zwycięzcą/remisem.
- Reset danych testowych w panelu mastera.

## 5. Zasady punktacji

- Dokładny wynik: 3 punkty.
- Dobry zwycięzca albo remis bez dokładnego wyniku: 1 punkt.
- Nietrafiony typ: 0 punktów.

## 6. Wrzucenie na GitHub

Z folderu repozytorium:

```powershell
cd "C:\Users\Maciej\OneDrive\Dokumenty\MS_2026"
git add ME_2028
git commit -m "Dodaj prototyp ME 2028 z Supabase"
git push
```

Po publikacji GitHub Pages strona powinna być dostępna pod jednym z adresów:

- `https://korghdor.github.io/MS_2026/ME_2028/`
- albo `https://korghdor.github.io/ME_2028/`

To zależy od tego, jak skonfigurowane jest repozytorium GitHub Pages.

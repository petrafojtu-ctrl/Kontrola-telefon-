# Kontrola fakturovaných telefonních čísel – GitHub Pages

Statická webová aplikace. PDF se zpracovává přímo v prohlížeči a telefonní čísla se porovnávají s přiloženou databází `databaze.json`.

## Soubory do kořene GitHub repozitáře

- `index.html`
- `styles.css`
- `app.js`
- `databaze.json`

## Zapnutí GitHub Pages

1. Nahraj uvedené soubory do hlavní úrovně repozitáře.
2. GitHub → **Settings** → **Pages**.
3. V **Build and deployment** vyber **Deploy from a branch**.
4. Branch: `main`, Folder: `/ (root)`.
5. Klikni na **Save**.

## První verze umí

- nahrát textové PDF,
- vyhledat telefonní čísla,
- sjednotit formát na 9 číslic, včetně odstranění 420 / 421 / 36,
- porovnat čísla s databází,
- zobrazit vlastníka, oddělení, majetkovou kartu, stav, název a poslední kontrolu,
- filtrovat nalezená / nenalezená čísla,
- vyhledávat přímo v databázi,
- exportovat výsledek do CSV.

## Omezení

Naskenované PDF bez textové vrstvy zatím neumí OCR. Detekci konkrétního formátu faktury lze zpřesnit podle vzorového PDF operátora.

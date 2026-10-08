# Kontrola fakturovaných telefonních čísel

Jednoduchá Streamlit aplikace pro porovnání telefonních čísel z PDF s databází SIM karet.

## Spuštění

1. Nainstalujte Python 3.10+.
2. Ve složce aplikace spusťte:

```bash
pip install -r requirements.txt
streamlit run app.py
```

3. Otevře se webová stránka, do které nahrajete jedno nebo více PDF.

## Co aplikace dělá

- extrahuje telefonní čísla z textových PDF,
- normalizuje CZ/SK/HU varianty na 9 číslic,
- porovná je s přiloženou databází,
- zobrazí čísla nalezená i nenalezená v databázi,
- u nalezených čísel doplní interní údaje z databáze,
- umožní export výsledku do XLSX.

Poznámka: první verze nepoužívá OCR. U čistě naskenovaných PDF bez textové vrstvy zobrazí upozornění.

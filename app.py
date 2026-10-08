import io
import re
from pathlib import Path

import pandas as pd
import streamlit as st
import fitz  # PyMuPDF

APP_DIR = Path(__file__).resolve().parent
DEFAULT_DB = APP_DIR / "databaze.xlsx"

st.set_page_config(page_title="Kontrola fakturovaných telefonních čísel", page_icon="📱", layout="wide")


def digits_only(value):
    if pd.isna(value):
        return ""
    return re.sub(r"\D", "", str(value))


def normalize_phone(raw):
    """Normalize to the 9-digit form used in the master database."""
    d = digits_only(raw)
    if not d:
        return None

    # International prefixes used in the source data.
    if d.startswith("00420") and len(d) >= 14:
        d = d[5:]
    elif d.startswith("00421") and len(d) >= 14:
        d = d[5:]
    elif d.startswith("0036") and len(d) >= 13:
        d = d[4:]
    elif d.startswith("420") and len(d) == 12:
        d = d[3:]
    elif d.startswith("421") and len(d) == 12:
        d = d[3:]
    elif d.startswith("36") and len(d) == 11:
        d = d[2:]

    # Occasional national trunk zero before a 9-digit stored number.
    if len(d) == 10 and d.startswith("0"):
        d = d[1:]

    return d if len(d) == 9 else None


def read_pdf(uploaded_file):
    data = uploaded_file.read()
    doc = fitz.open(stream=data, filetype="pdf")
    pages = []
    for page_no, page in enumerate(doc, start=1):
        text = page.get_text("text") or ""
        pages.append((page_no, text))
    return pages


def extract_candidates(pages):
    # Candidate sequences: digits with spaces, dashes, parentheses or +.
    pattern = re.compile(r"(?<!\d)(?:\+|00)?\d[\d\s()./-]{7,20}\d(?!\d)")
    found = []
    for page_no, text in pages:
        for match in pattern.finditer(text):
            raw = match.group(0).strip()
            norm = normalize_phone(raw)
            if norm:
                found.append({"Telefonní číslo": norm, "Nalezený zápis": raw, "Strana PDF": page_no})
    return pd.DataFrame(found)


def load_database(path_or_file):
    df = pd.read_excel(path_or_file, dtype=str)
    if df.shape[1] < 5:
        raise ValueError("Databáze nemá očekávaný počet sloupců.")

    # In the final source table the phone numbers are in column E.
    phone_col = df.columns[4]
    df["Telefonní číslo"] = df[phone_col].map(normalize_phone)
    df = df[df["Telefonní číslo"].notna()].copy()

    # The source header in E remained from the old dataset. Hide it to avoid confusion.
    cols = [c for i, c in enumerate(df.columns) if i != 4 and c != "Telefonní číslo"]
    df = df[["Telefonní číslo"] + cols]
    return df


def to_excel_bytes(sheets):
    out = io.BytesIO()
    with pd.ExcelWriter(out, engine="openpyxl") as writer:
        for name, frame in sheets.items():
            frame.to_excel(writer, sheet_name=name[:31], index=False)
            ws = writer.book[name[:31]]
            ws.freeze_panes = "A2"
            ws.auto_filter.ref = ws.dimensions
            for col_cells in ws.columns:
                max_len = max((len(str(c.value)) if c.value is not None else 0) for c in col_cells)
                ws.column_dimensions[col_cells[0].column_letter].width = min(max(max_len + 2, 12), 45)
    out.seek(0)
    return out.getvalue()


st.title("📱 Kontrola fakturovaných telefonních čísel")
st.caption("Nahraj PDF faktury/výpisu. Nástroj najde telefonní čísla a porovná je s interní databází.")

with st.sidebar:
    st.header("Databáze")
    use_default = st.toggle("Použít přiloženou databázi", value=True)
    db_upload = None
    if not use_default:
        db_upload = st.file_uploader("Nahraj databázi XLSX", type=["xlsx"], key="db")
    st.info("Porovnání používá telefonní čísla ze sloupce E a normalizuje je na 9 číslic.")

pdf_files = st.file_uploader("Nahraj PDF", type=["pdf"], accept_multiple_files=True)

if pdf_files:
    try:
        db_source = DEFAULT_DB if use_default else db_upload
        if db_source is None:
            st.warning("Nejdříve nahraj databázi XLSX.")
            st.stop()
        db = load_database(db_source)
    except Exception as e:
        st.error(f"Databázi se nepodařilo načíst: {e}")
        st.stop()

    all_found = []
    empty_text_pdfs = []
    for f in pdf_files:
        pages = read_pdf(f)
        if not any(text.strip() for _, text in pages):
            empty_text_pdfs.append(f.name)
        candidates = extract_candidates(pages)
        if not candidates.empty:
            candidates.insert(0, "PDF", f.name)
            all_found.append(candidates)

    if empty_text_pdfs:
        st.warning(
            "U těchto PDF nebyla nalezena textová vrstva: " + ", ".join(empty_text_pdfs) +
            ". Pravděpodobně jde o sken a bude potřeba OCR verze nástroje."
        )

    if not all_found:
        st.error("V PDF se nepodařilo najít žádná devítimístná telefonní čísla.")
        st.stop()

    found = pd.concat(all_found, ignore_index=True)
    # One invoice line / number may appear multiple times; retain source evidence but summarize unique numbers for matching.
    unique_found = found.sort_values(["Telefonní číslo", "PDF", "Strana PDF"]).drop_duplicates("Telefonní číslo")

    matched = unique_found.merge(db, on="Telefonní číslo", how="inner")
    unmatched = unique_found[~unique_found["Telefonní číslo"].isin(db["Telefonní číslo"])].copy()
    missing_from_pdf = db[~db["Telefonní číslo"].isin(unique_found["Telefonní číslo"])].copy()

    c1, c2, c3, c4 = st.columns(4)
    c1.metric("Unikátní čísla v PDF", len(unique_found))
    c2.metric("Nalezeno v databázi", len(matched))
    c3.metric("Není v databázi", len(unmatched))
    c4.metric("DB čísla mimo PDF", len(missing_from_pdf))

    if len(unmatched) == 0:
        st.success("Všechna telefonní čísla nalezená v PDF jsou v databázi.")
    else:
        st.error(f"{len(unmatched)} telefonních čísel z PDF není v databázi.")

    tabs = st.tabs(["⚠️ Není v databázi", "✅ Nalezeno", "📋 Všechna čísla z PDF", "➖ DB mimo PDF"])
    with tabs[0]:
        st.dataframe(unmatched, use_container_width=True, hide_index=True)
    with tabs[1]:
        st.dataframe(matched, use_container_width=True, hide_index=True)
    with tabs[2]:
        st.dataframe(found, use_container_width=True, hide_index=True)
    with tabs[3]:
        st.caption("Tento seznam je informativní – neznamená automaticky chybu fakturace.")
        st.dataframe(missing_from_pdf, use_container_width=True, hide_index=True)

    report = to_excel_bytes({
        "Nenalezeno v DB": unmatched,
        "Nalezeno v DB": matched,
        "Vsechna cisla PDF": found,
        "DB mimo PDF": missing_from_pdf,
    })
    st.download_button(
        "⬇️ Stáhnout výsledek do Excelu",
        data=report,
        file_name="kontrola_fakturovanych_cisel.xlsx",
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
else:
    st.info("Nahraj alespoň jeden PDF soubor.")

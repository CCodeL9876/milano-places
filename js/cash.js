// Reisekasse: wer hat was bezahlt, wer profitiert, wer schuldet wem.
// Alle Beträge in Cent (Ganzzahlen) – so entstehen beim Aufteilen keine Rundungsfehler.
//
// Teilnehmende: [{ id, name }]
// Rechnung:     { id, title, amountCents, paidBy: id, sharedWith: [id, …], date: 'JJJJ-MM-TT' | '' }

const EURO = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
export const formatEuro = (cents) => EURO.format((cents || 0) / 100);

// „12,50“, „12.50“, „1.234,50“, „1'234.50“, „12“ → Cent; ungültig oder ≤ 0 → null
export function parseAmount(input) {
  let s = String(input || '').trim().replace(/[\s'’€]/g, '');
  if (!s) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    // Beide Zeichen: das hintere ist das Dezimaltrennzeichen, das andere Tausendertrennung
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else {
    s = s.replace(',', '.');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return cents > 0 && cents <= 100000000 ? cents : null;
}

// Gleichmässig aufteilen; übrige Cent gehen der Reihe nach an die ersten Personen,
// damit die Summe der Anteile immer genau dem Betrag entspricht.
export function splitCents(amountCents, ids) {
  const shares = new Map();
  if (!ids.length) return shares;
  const base = Math.floor(amountCents / ids.length);
  let rest = amountCents - base * ids.length;
  for (const id of ids) {
    shares.set(id, base + (rest > 0 ? 1 : 0));
    if (rest > 0) rest--;
  }
  return shares;
}

// Pro Person: bezahlt, Anteil (was sie verbraucht hat) und Saldo (+ bekommt Geld, − schuldet Geld).
// Personen, die in Rechnungen vorkommen, aber nicht mehr in der Liste stehen, erscheinen als „Unbekannt“.
export function computeBalances(expenses, participants) {
  const rows = new Map(participants.map((p) => [p.id, { id: p.id, name: p.name, paid: 0, share: 0 }]));
  const row = (id) => {
    if (!rows.has(id)) rows.set(id, { id, name: 'Unbekannt', paid: 0, share: 0 });
    return rows.get(id);
  };
  for (const e of expenses) {
    row(e.paidBy).paid += e.amountCents;
    for (const [id, cents] of splitCents(e.amountCents, e.sharedWith)) row(id).share += cents;
  }
  return [...rows.values()].map((r) => ({ ...r, balance: r.paid - r.share }));
}

// Ausgleich mit möglichst wenigen Überweisungen: jeweils wer am meisten schuldet zahlt an den,
// der am meisten zugute hat. Ergebnis: [{ from, to, cents }] mit Personen-IDs.
export function settle(balances) {
  const debtors = balances.filter((b) => b.balance < 0).map((b) => ({ id: b.id, cents: -b.balance }));
  const creditors = balances.filter((b) => b.balance > 0).map((b) => ({ id: b.id, cents: b.balance }));
  debtors.sort((a, b) => b.cents - a.cents);
  creditors.sort((a, b) => b.cents - a.cents);
  const transfers = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const cents = Math.min(debtors[i].cents, creditors[j].cents);
    if (cents > 0) transfers.push({ from: debtors[i].id, to: creditors[j].id, cents });
    debtors[i].cents -= cents;
    creditors[j].cents -= cents;
    if (!debtors[i].cents) i++;
    if (!creditors[j].cents) j++;
  }
  return transfers;
}

// Werte aus Datenbank oder Backup absichern, bevor sie ins HTML gelangen
export function sanitizeParticipants(list) {
  return (Array.isArray(list) ? list : [])
    .filter((p) => p && p.id && String(p.name || '').trim())
    .map((p) => ({ id: String(p.id).slice(0, 64), name: String(p.name).trim().slice(0, 30) }));
}

export function sanitizeExpense(e) {
  if (!e || !e.id) return null;
  const amountCents = Math.round(Number(e.amountCents));
  const sharedWith = (Array.isArray(e.sharedWith) ? e.sharedWith : []).map(String).filter(Boolean);
  if (!(amountCents > 0) || !e.paidBy || !sharedWith.length) return null;
  return {
    id: String(e.id),
    title: String(e.title || '').slice(0, 120),
    amountCents,
    paidBy: String(e.paidBy),
    sharedWith: [...new Set(sharedWith)],
    date: /^\d{4}-\d{2}-\d{2}$/.test(e.date || '') ? e.date : '',
    addedBy: String(e.addedBy || '').slice(0, 80),
    addedAt: Number(e.addedAt) || 0,
  };
}

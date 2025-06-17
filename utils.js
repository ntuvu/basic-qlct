export function parseExcelDate(value) {
  if (typeof value === 'number') {
    // Excel serial date to JS date
    const jsDate = new Date((value - 25569) * 86400 * 1000);
    return dayjs(jsDate).format('YYYY-MM-DD');
  } else if (typeof value === 'string') {
    // Try parsing as DD/MM/YYYY
    const d = dayjs(value, 'DD/MM/YYYY', true);
    if (d.isValid()) return d.format('YYYY-MM-DD');
    // Try parsing as YYYY-MM-DD
    const d2 = dayjs(value, 'YYYY-MM-DD', true);
    if (d2.isValid()) return d2.format('YYYY-MM-DD');
    // Fallback: try native Date
    const d3 = dayjs(value);
    if (d3.isValid()) return d3.format('YYYY-MM-DD');
  }
  return null;
}
export class DataParser {
  static parseClipboard(rawText) {
    if (!rawText || !rawText.trim()) return { headers: [], data: [] };

    // 1. Split lines
    const lines = rawText.trim().split(/\r?\n/);
    if (lines.length === 0) return { headers: [], data: [] };

    // 2. Detect delimiter (Prioritize TAB, then Semicolon, then Comma)
    const firstLine = lines[0];
    let delimiter = '\t';
    if (!firstLine.includes('\t')) {
       if (firstLine.includes(';')) delimiter = ';';
       else if (firstLine.includes(',')) delimiter = ',';
    }

    // 3. Create matrix
    let matrix = lines.map(line => line.split(delimiter).map(cell => cell.trim()));

    // 4. Header detection
    // If first row has non-numeric text, consider it a header.
    const isHeader = matrix[0].some(cell => isNaN(this.toSafeFloat(cell)));
    const headers = isHeader ? matrix.shift() : matrix[0].map((_, i) => `Variavel ${i+1}`);

    // 5. Parse data
    const parsedData = matrix.map(row => row.map(cell => this.toSafeFloat(cell)));

    return { headers, data: parsedData };
  }

  static toSafeFloat(str) {
    if (str === null || str === undefined || str === '') return null;
    let s = String(str).replace(/\s+/g, '').replace(/[R$]/g, '');

    if (s.includes(',') && s.split('.').length > 1) {
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.');
      } else {
        s = s.replace(/,/g, '');
      }
    } else if (s.includes(',')) {
      s = s.replace(',', '.');
    }

    const num = parseFloat(s);
    return isNaN(num) ? str : num;
  }
}

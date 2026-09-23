import ExcelJS from 'exceljs';

/**
 * เครื่องมือสร้างไฟล์ CSV / Excel ที่ใช้ร่วมกัน
 *
 * ย้ายออกมาจาก `import-export.service.ts` ตอน STEP 26 เพราะรายงานยอดขายต้องใช้ชุดเดียวกัน
 * ถ้าปล่อยให้แต่ละบริการสร้างไฟล์เอง หัวตารางจะคนละสไตล์ และที่แย่กว่าคือ
 * **มีที่หนึ่งลืมใส่ UTF-8 BOM แล้วไฟล์ CSV เปิดใน Excel บน Windows เป็นภาษาต่างดาว**
 */

export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const MIME_CSV = 'text/csv; charset=utf-8';

/**
 * ⚠️ Excel บน Windows เดา encoding ของ CSV จาก BOM
 *    ไม่มี BOM = ภาษาไทยเพี้ยนทั้งไฟล์ ทั้งที่ข้อมูลถูกต้องทุกตัว
 */
const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);

/** ต้องตรงกับ `fileFormatSchema` ใน validators/import-export.validator.ts (แหล่งความจริงเดียว) */
export type FileFormatCode = 'csv' | 'xlsx';

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/** สไตล์หัวตาราง + ความกว้างคอลัมน์อัตโนมัติ (ใช้ design token ของแบรนด์) */
export function styleWorksheet(worksheet: ExcelJS.Worksheet): void {
  const headerRow = worksheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: 'FF5B21B6' } }; // brand-dark
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFEDE9FE' }, // lilac
  };
  headerRow.alignment = { vertical: 'middle' };
  headerRow.height = 24;

  worksheet.columns.forEach((column) => {
    let maxLength = 12;
    if (column.header) {
      maxLength = Math.max(maxLength, String(column.header).length + 4);
    }
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const valStr = cell.value ? String(cell.value) : '';
      maxLength = Math.max(maxLength, Math.min(valStr.length + 2, 50));
    });
    column.width = maxLength;
  });
}

export async function workbookToBuffer(
  workbook: ExcelJS.Workbook,
  format: FileFormatCode,
): Promise<Buffer> {
  if (format === 'csv') {
    const rawCsv = (await workbook.csv.writeBuffer()) as unknown as Buffer;
    return Buffer.concat([UTF8_BOM, Buffer.from(rawCsv)]);
  }

  const rawXlsx = (await workbook.xlsx.writeBuffer()) as unknown as Buffer;
  return Buffer.from(rawXlsx);
}

export function mimeTypeFor(format: FileFormatCode): string {
  return format === 'csv' ? MIME_CSV : MIME_XLSX;
}

export function extensionFor(format: FileFormatCode): string {
  return format === 'csv' ? 'csv' : 'xlsx';
}

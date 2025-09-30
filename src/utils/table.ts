import * as XLSX from 'xlsx'

export function exportToExcel(filename:string, rows:any[]){
  if(!rows || !rows.length) return
  const ws = XLSX.utils.json_to_sheet(rows)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
  XLSX.writeFile(wb, filename)
}

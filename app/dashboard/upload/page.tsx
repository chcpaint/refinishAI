'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Upload, FileText, AlertCircle, CheckCircle, X, FileSpreadsheet,
  File, Trash2, Eye, ChevronDown, ChevronRight, RefreshCw,
  Download, Settings, HelpCircle, Clock, ArrowRight
} from 'lucide-react'

interface ParsedRow {
  [key: string]: string | number | null
}

interface UploadResult {
  success: boolean
  message: string
  count?: number
  errors?: string[]
}

interface UploadHistory {
  id: string
  filename: string
  data_type: string
  records_imported: number
  created_at: string
  status: string
}

interface FieldMapping {
  sourceField: string
  targetField: string
  required: boolean
}

const ESTIMATE_FIELDS = [
  { name: 'estimate_number', label: 'Estimate Number', required: true },
  { name: 'customer_name', label: 'Customer Name', required: false },
  { name: 'vin', label: 'VIN', required: false },
  { name: 'estimate_date', label: 'Estimate Date', required: true },
  { name: 'expected_start_date', label: 'Expected Start Date', required: false },
  { name: 'total_amount', label: 'Total Amount', required: false },
  { name: 'status', label: 'Status', required: false },
]

const INVOICE_FIELDS = [
  { name: 'invoice_number', label: 'Invoice Number', required: true },
  { name: 'customer_name', label: 'Customer Name', required: false },
  { name: 'vin', label: 'VIN', required: false },
  { name: 'invoice_date', label: 'Invoice Date', required: true },
  { name: 'completion_date', label: 'Completion Date', required: true },
  { name: 'total_amount', label: 'Total Amount', required: false },
]

const PRODUCT_FIELDS = [
  { name: 'sku', label: 'SKU', required: true },
  { name: 'name', label: 'Product Name', required: true },
  { name: 'category', label: 'Category', required: true },
  { name: 'unit_type', label: 'Unit Type', required: false },
  { name: 'unit_cost', label: 'Unit Cost', required: false },
  { name: 'coverage_sqft_per_unit', label: 'Coverage (sq ft)', required: false },
  { name: 'supplier', label: 'Supplier', required: false },
  { name: 'lead_time_days', label: 'Lead Time (days)', required: false },
]

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [result, setResult] = useState<UploadResult | null>(null)
  const [dataType, setDataType] = useState<'estimate' | 'invoice' | 'product'>('estimate')
  const [parsedData, setParsedData] = useState<ParsedRow[]>([])
  const [headers, setHeaders] = useState<string[]>([])
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({})
  const [showPreview, setShowPreview] = useState(false)
  const [showMapping, setShowMapping] = useState(false)
  const [uploadHistory, setUploadHistory] = useState<UploadHistory[]>([])
  const [dragActive, setDragActive] = useState(false)
  const [companyId, setCompanyId] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    loadUserCompany()
    loadUploadHistory()
  }, [])

  const loadUserCompany = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('company_id')
        .eq('id', user.id)
        .single()

      if (profile?.company_id) {
        setCompanyId(profile.company_id)
      }
    }
  }

  const loadUploadHistory = async () => {
    const { data } = await supabase
      .from('upload_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10)

    if (data) setUploadHistory(data)
  }

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0])
    }
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFile(e.target.files[0])
    }
  }

  const handleFile = async (selectedFile: File) => {
    setFile(selectedFile)
    setResult(null)
    setParsedData([])
    setHeaders([])
    setFieldMappings({})
    setShowPreview(false)
    setShowMapping(false)

    // Parse the file
    setParsing(true)
    try {
      const extension = selectedFile.name.split('.').pop()?.toLowerCase()

      if (extension === 'csv') {
        await parseCSV(selectedFile)
      } else if (extension === 'xlsx' || extension === 'xls') {
        await parseExcel(selectedFile)
      } else if (extension === 'pdf') {
        await parsePDF(selectedFile)
      } else {
        setResult({ success: false, message: 'Unsupported file format' })
      }
    } catch (error) {
      console.error('Parse error:', error)
      setResult({ success: false, message: 'Error parsing file. Please check the format.' })
    } finally {
      setParsing(false)
    }
  }

  const parseCSV = async (csvFile: File) => {
    const text = await csvFile.text()
    const lines = text.split('\n').filter(line => line.trim())

    if (lines.length < 2) {
      setResult({ success: false, message: 'File appears to be empty or has no data rows' })
      return
    }

    // Parse headers - handle quoted values
    const headerLine = lines[0]
    const fileHeaders = parseCSVLine(headerLine)
    setHeaders(fileHeaders)

    // Parse data rows
    const data: ParsedRow[] = []
    for (let i = 1; i < lines.length; i++) {
      const values = parseCSVLine(lines[i])
      if (values.length === fileHeaders.length) {
        const row: ParsedRow = {}
        fileHeaders.forEach((header, index) => {
          row[header] = values[index]
        })
        data.push(row)
      }
    }

    setParsedData(data)
    autoMapFields(fileHeaders)
    setShowMapping(true)
  }

  const parseCSVLine = (line: string): string[] => {
    const result: string[] = []
    let current = ''
    let inQuotes = false

    for (let i = 0; i < line.length; i++) {
      const char = line[i]

      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        result.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    result.push(current.trim())

    return result
  }

  const parseExcel = async (excelFile: File) => {
    try {
      // Dynamic import of xlsx
      const XLSX = await import('xlsx')

      const arrayBuffer = await excelFile.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })

      // Get first sheet
      const sheetName = workbook.SheetNames[0]
      const worksheet = workbook.Sheets[sheetName]

      // Convert to JSON
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][]

      if (jsonData.length < 2) {
        setResult({ success: false, message: 'Excel file appears to be empty' })
        return
      }

      // First row is headers
      const fileHeaders = jsonData[0].map(h => String(h || '').trim())
      setHeaders(fileHeaders)

      // Rest is data
      const data: ParsedRow[] = []
      for (let i = 1; i < jsonData.length; i++) {
        const row: ParsedRow = {}
        const values = jsonData[i]
        if (values && values.some(v => v !== undefined && v !== '')) {
          fileHeaders.forEach((header, index) => {
            row[header] = values[index] !== undefined ? values[index] : null
          })
          data.push(row)
        }
      }

      setParsedData(data)
      autoMapFields(fileHeaders)
      setShowMapping(true)
    } catch (error) {
      console.error('Excel parse error:', error)
      setResult({ success: false, message: 'Error parsing Excel file. Make sure the file is valid.' })
    }
  }

  const parsePDF = async (pdfFile: File) => {
    try {
      // Dynamic import of pdfjs-dist
      const pdfjsLib = await import('pdfjs-dist')

      // Use local worker from public directory (avoids CDN failures that cause hangs)
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'

      const arrayBuffer = await pdfFile.arrayBuffer()

      // Wrap PDF loading in a timeout to prevent infinite spinner
      const loadPDF = async () => {
        const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer })
        return await loadingTask.promise
      }

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('PDF parsing timed out after 30 seconds. Please try a CSV or Excel file instead.')), 30000)
      )

      const pdf = await Promise.race([loadPDF(), timeoutPromise])

      let fullText = ''

      // Extract text from all pages
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i)
        const textContent = await page.getTextContent()
        const pageText = textContent.items
          .map((item: any) => item.str)
          .join(' ')
        fullText += pageText + '\n'
      }

      // Try to parse structured data from PDF text
      const data = parsePDFText(fullText)

      if (data.length === 0) {
        setResult({
          success: false,
          message: 'Could not extract structured data from PDF. Please use CSV or Excel format.'
        })
        return
      }

      const fileHeaders = Object.keys(data[0])
      setHeaders(fileHeaders)
      setParsedData(data)
      autoMapFields(fileHeaders)
      setShowMapping(true)
    } catch (error: any) {
      console.error('PDF parse error:', error)
      const message = error?.message?.includes('timed out')
        ? error.message
        : 'Error parsing PDF file. Try uploading a CSV or Excel file instead.'
      setResult({ success: false, message })
    }
  }

  const parsePDFText = (text: string): ParsedRow[] => {
    const data: ParsedRow[] = []

    // Try to find estimate/invoice patterns
    const estimatePattern = /(?:Estimate|Invoice)[\s#:]*(\w+)/gi
    const vinPattern = /VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/gi
    const amountPattern = /(?:Total|Amount)[:\s]*\$?([\d,]+\.?\d*)/gi
    const datePattern = /(?:Date)[:\s]*(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi
    const customerPattern = /(?:Customer|Name)[:\s]*([A-Za-z\s]+?)(?:\n|$)/gi

    // Extract all matches
    const estimates = Array.from(text.matchAll(estimatePattern))
    const vins = Array.from(text.matchAll(vinPattern))
    const amounts = Array.from(text.matchAll(amountPattern))
    const dates = Array.from(text.matchAll(datePattern))
    const customers = Array.from(text.matchAll(customerPattern))

    // Create rows from extracted data
    const maxRows = Math.max(estimates.length, vins.length, 1)
    for (let i = 0; i < maxRows; i++) {
      data.push({
        'Estimate/Invoice #': estimates[i]?.[1] || '',
        'VIN': vins[i]?.[1] || '',
        'Total Amount': amounts[i]?.[1]?.replace(',', '') || '',
        'Date': dates[i]?.[1] || '',
        'Customer': customers[i]?.[1]?.trim() || ''
      })
    }

    return data.filter(row => Object.values(row).some(v => v))
  }

  const autoMapFields = (fileHeaders: string[]) => {
    const mappings: Record<string, string> = {}
    const targetFields = dataType === 'estimate' ? ESTIMATE_FIELDS
      : dataType === 'invoice' ? INVOICE_FIELDS
      : PRODUCT_FIELDS

    targetFields.forEach(field => {
      // Try to auto-match based on similar names
      const matchingHeader = fileHeaders.find(h => {
        const headerLower = h.toLowerCase().replace(/[_\s-]/g, '')
        const fieldLower = field.name.toLowerCase().replace(/[_\s-]/g, '')
        const labelLower = field.label.toLowerCase().replace(/[_\s-]/g, '')

        return headerLower.includes(fieldLower) ||
               fieldLower.includes(headerLower) ||
               headerLower.includes(labelLower) ||
               labelLower.includes(headerLower)
      })

      if (matchingHeader) {
        mappings[field.name] = matchingHeader
      }
    })

    setFieldMappings(mappings)
  }

  const handleUpload = async () => {
    if (parsedData.length === 0) return

    setUploading(true)
    setResult(null)

    try {
      const tableName = dataType === 'estimate' ? 'estimates'
        : dataType === 'invoice' ? 'invoices'
        : 'products'

      let inserted = 0
      const errors: string[] = []

      for (let i = 0; i < parsedData.length; i++) {
        const row = parsedData[i]
        const mappedData: Record<string, any> = {}

        // Map fields
        Object.entries(fieldMappings).forEach(([targetField, sourceField]) => {
          if (sourceField && row[sourceField] !== undefined) {
            let value = row[sourceField]

            // Type conversions
            if (targetField.includes('amount') || targetField.includes('cost') || targetField.includes('coverage')) {
              value = parseFloat(String(value).replace(/[,$]/g, '')) || 0
            } else if (targetField.includes('days')) {
              value = parseInt(String(value)) || 0
            } else if (targetField.includes('date')) {
              value = formatDate(String(value))
            }

            mappedData[targetField] = value
          }
        })

        // Add company_id to all records
        if (companyId) {
          mappedData.company_id = companyId
        }

        // Add default values
        if (dataType === 'estimate') {
          mappedData.source = 'Upload'
          mappedData.status = mappedData.status || 'Quoted'
          if (!mappedData.estimate_date) mappedData.estimate_date = new Date().toISOString().split('T')[0]
        } else if (dataType === 'invoice') {
          mappedData.source = 'Upload'
          if (!mappedData.invoice_date) mappedData.invoice_date = new Date().toISOString().split('T')[0]
          if (!mappedData.completion_date) mappedData.completion_date = mappedData.invoice_date
        } else if (dataType === 'product') {
          mappedData.unit_type = mappedData.unit_type || 'Gallon'
          mappedData.waste_factor = 0.15
        }

        // Insert row
        const { error } = await supabase.from(tableName).insert([mappedData])

        if (error) {
          errors.push(`Row ${i + 1}: ${error.message}`)
        } else {
          inserted++
        }
      }

      // Log upload history
      await supabase.from('upload_history').insert({
        filename: file?.name,
        data_type: dataType,
        records_imported: inserted,
        status: errors.length > 0 ? 'partial' : 'success'
      })

      setResult({
        success: inserted > 0,
        message: inserted > 0
          ? `Successfully imported ${inserted} ${dataType}(s)${errors.length > 0 ? ` with ${errors.length} errors` : ''}`
          : 'No records were imported',
        count: inserted,
        errors: errors.slice(0, 5)
      })

      loadUploadHistory()
    } catch (error) {
      console.error('Upload error:', error)
      setResult({
        success: false,
        message: 'Error uploading data. Please try again.'
      })
    } finally {
      setUploading(false)
    }
  }

  const formatDate = (dateStr: string): string => {
    if (!dateStr) return new Date().toISOString().split('T')[0]

    // Try parsing various date formats
    const date = new Date(dateStr)
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0]
    }

    // Try MM/DD/YYYY or DD/MM/YYYY
    const parts = dateStr.split(/[\/\-]/)
    if (parts.length === 3) {
      const [a, b, c] = parts.map(p => parseInt(p))
      if (c > 1900) {
        return `${c}-${String(a).padStart(2, '0')}-${String(b).padStart(2, '0')}`
      } else if (a > 1900) {
        return `${a}-${String(b).padStart(2, '0')}-${String(c).padStart(2, '0')}`
      }
    }

    return new Date().toISOString().split('T')[0]
  }

  const clearFile = () => {
    setFile(null)
    setParsedData([])
    setHeaders([])
    setFieldMappings({})
    setShowPreview(false)
    setShowMapping(false)
    setResult(null)
  }

  const targetFields = dataType === 'estimate' ? ESTIMATE_FIELDS
    : dataType === 'invoice' ? INVOICE_FIELDS
    : PRODUCT_FIELDS

  const downloadTemplate = () => {
    const fields = targetFields.map(f => f.label)
    const csvContent = fields.join(',') + '\n'
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${dataType}_template.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Upload Data</h1>
          <p className="text-gray-600 mt-2">Import estimates, invoices, and products from files</p>
        </div>
        <button
          onClick={downloadTemplate}
          className="flex items-center gap-2 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50"
        >
          <Download className="w-4 h-4" />
          Download Template
        </button>
      </div>

      {/* Data Type Selection */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">What are you uploading?</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { type: 'estimate', label: 'Estimates', desc: 'Future work/quotes', icon: FileText },
            { type: 'invoice', label: 'Invoices', desc: 'Completed work history', icon: FileSpreadsheet },
            { type: 'product', label: 'Products', desc: 'Paint & material catalog', icon: File }
          ].map(item => (
            <button
              key={item.type}
              onClick={() => {
                setDataType(item.type as any)
                if (headers.length > 0) autoMapFields(headers)
              }}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                dataType === item.type
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <item.icon className={`w-8 h-8 mb-2 ${dataType === item.type ? 'text-blue-600' : 'text-gray-400'}`} />
              <p className="font-semibold text-gray-900">{item.label}</p>
              <p className="text-sm text-gray-500">{item.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* File Upload Area */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive
              ? 'border-blue-500 bg-blue-50'
              : file
              ? 'border-green-500 bg-green-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <input
            type="file"
            accept=".csv,.xlsx,.xls,.pdf"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />

          {parsing ? (
            <div className="flex flex-col items-center">
              <RefreshCw className="w-12 h-12 text-blue-500 animate-spin mb-4" />
              <p className="text-gray-600">Parsing file...</p>
            </div>
          ) : file ? (
            <div className="flex flex-col items-center">
              <CheckCircle className="w-12 h-12 text-green-500 mb-4" />
              <p className="font-medium text-gray-900">{file.name}</p>
              <p className="text-sm text-gray-500 mt-1">
                {parsedData.length} rows detected
              </p>
              <button
                onClick={clearFile}
                className="mt-4 text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
              >
                <Trash2 className="w-4 h-4" />
                Remove file
              </button>
            </div>
          ) : (
            <label htmlFor="file-upload" className="cursor-pointer">
              <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600 mb-2">
                <span className="text-blue-600 font-medium">Click to upload</span> or drag and drop
              </p>
              <p className="text-sm text-gray-500">
                CSV, Excel (.xlsx), or PDF files up to 10MB
              </p>
            </label>
          )}
        </div>
      </div>

      {/* Field Mapping */}
      {showMapping && headers.length > 0 && (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Map Your Fields</h2>
            <button
              onClick={() => setShowPreview(!showPreview)}
              className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1"
            >
              <Eye className="w-4 h-4" />
              {showPreview ? 'Hide' : 'Show'} Preview
            </button>
          </div>

          <p className="text-sm text-gray-600 mb-4">
            Match your file columns to the required fields. We've auto-detected some matches.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {targetFields.map(field => (
              <div key={field.name} className="flex items-center gap-3">
                <div className="w-1/2">
                  <label className="block text-sm font-medium text-gray-700">
                    {field.label}
                    {field.required && <span className="text-red-500 ml-1">*</span>}
                  </label>
                </div>
                <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                <select
                  value={fieldMappings[field.name] || ''}
                  onChange={(e) => setFieldMappings({
                    ...fieldMappings,
                    [field.name]: e.target.value
                  })}
                  className={`flex-1 px-3 py-2 border rounded-lg text-sm ${
                    field.required && !fieldMappings[field.name]
                      ? 'border-red-300 bg-red-50'
                      : 'border-gray-300'
                  }`}
                >
                  <option value="">-- Select column --</option>
                  {headers.map(header => (
                    <option key={header} value={header}>{header}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {/* Data Preview */}
          {showPreview && parsedData.length > 0 && (
            <div className="mt-6 border border-gray-200 rounded-lg overflow-hidden">
              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                <p className="text-sm font-medium text-gray-700">
                  Preview (first 5 rows)
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      {headers.map(header => (
                        <th key={header} className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                          {header}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsedData.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        {headers.map(header => (
                          <td key={header} className="px-3 py-2 text-gray-600 whitespace-nowrap">
                            {String(row[header] || '-')}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Upload Button */}
          <div className="mt-6 flex justify-end">
            <button
              onClick={handleUpload}
              disabled={uploading || parsedData.length === 0}
              className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 transition-colors"
            >
              {uploading ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="w-5 h-5" />
                  Import {parsedData.length} {dataType}(s)
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Result Message */}
      {result && (
        <div className={`p-4 rounded-lg ${result.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
          <div className="flex items-start gap-3">
            {result.success ? (
              <CheckCircle className="w-5 h-5 text-green-600 flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
            )}
            <div className="flex-1">
              <p className={`font-medium ${result.success ? 'text-green-900' : 'text-red-900'}`}>
                {result.message}
              </p>
              {result.errors && result.errors.length > 0 && (
                <ul className="mt-2 text-sm text-red-700 list-disc list-inside">
                  {result.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Upload History */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Clock className="w-5 h-5 text-gray-400" />
          Recent Uploads
        </h2>

        {uploadHistory.length === 0 ? (
          <p className="text-gray-500 text-center py-8">No uploads yet</p>
        ) : (
          <div className="space-y-3">
            {uploadHistory.map((upload) => (
              <div
                key={upload.id}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex items-center gap-3">
                  <FileText className="w-5 h-5 text-gray-400" />
                  <div>
                    <p className="font-medium text-gray-900">{upload.filename}</p>
                    <p className="text-sm text-gray-500">
                      {upload.data_type} • {new Date(upload.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    upload.status === 'success' ? 'bg-green-100 text-green-700'
                    : upload.status === 'partial' ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-red-100 text-red-700'
                  }`}>
                    {upload.records_imported} imported
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Help Section */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <div className="flex gap-4">
          <HelpCircle className="w-6 h-6 text-blue-600 flex-shrink-0" />
          <div>
            <h3 className="font-bold text-blue-900 mb-2">Tips for Successful Imports</h3>
            <ul className="text-blue-800 space-y-1 text-sm">
              <li>• <strong>CSV files:</strong> Use comma-separated values with headers in the first row</li>
              <li>• <strong>Excel files:</strong> Put your data in the first sheet with headers in row 1</li>
              <li>• <strong>PDF files:</strong> Works best with structured documents; tables may not parse perfectly</li>
              <li>• <strong>Dates:</strong> Use formats like MM/DD/YYYY, YYYY-MM-DD, or DD-MM-YYYY</li>
              <li>• <strong>Amounts:</strong> Can include $ and commas (they'll be stripped automatically)</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

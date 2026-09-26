'use client'

import { useEffect, useRef } from 'react'

export interface StatModalRow {
  id: string
  title: string
  subtitle?: string
  value: number | string
}

interface StatModalProps {
  isOpen: boolean
  onClose: () => void
  title: string
  headers?: [string, string, string] // [Rank, Entity, Value]
  data: StatModalRow[]
}

export function StatModal({ isOpen, onClose, title, headers = ['#', 'Name', 'Value'], data }: StatModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (isOpen) {
      dialog.showModal()
    } else {
      dialog.close()
    }
  }, [isOpen])

  // Handle click outside to close
  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose()
    }
  }

  if (!isOpen) return null

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      onClose={onClose}
      className="backdrop:bg-black/60 bg-transparent w-full max-w-2xl m-auto p-4 open:animate-in open:fade-in open:zoom-in-95"
    >
      <div className="bg-[#0f172a] border border-white/10 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        <div className="flex justify-between items-center p-6 border-b border-white/10 bg-[#1e293b]">
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-2 -mr-2"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {data.length === 0 ? (
            <div className="text-center text-gray-500 py-10">
              No data available for {title.toLowerCase()}.
            </div>
          ) : (
            <table className="w-full text-left text-sm text-white">
              <thead className="bg-black/20 text-gray-400 sticky top-0 backdrop-blur">
                <tr>
                  <th className="p-4 rounded-tl-lg w-16">{headers[0]}</th>
                  <th className="p-4">{headers[1]}</th>
                  <th className="p-4 text-right rounded-tr-lg">{headers[2]}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {data.map((row, idx) => (
                  <tr key={row.id || idx} className="hover:bg-white/5 transition-colors">
                    <td className="p-4 text-gray-400 font-medium">{idx + 1}</td>
                    <td className="p-4">
                      <div className="font-semibold">{row.title}</div>
                      {row.subtitle && (
                        <div className="text-xs text-gray-500 mt-0.5">{row.subtitle}</div>
                      )}
                    </td>
                    <td className="p-4 text-right font-bold text-indigo-400 text-lg">
                      {row.value}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </dialog>
  )
}

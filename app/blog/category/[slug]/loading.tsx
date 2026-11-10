import { Loader2 } from "lucide-react"

export default function CategoryLoading() {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center">
      <div className="text-center">
        <Loader2 className="w-10 h-10 animate-spin text-green-600 mx-auto mb-4" />
        <p className="text-gray-600">Loading category...</p>
      </div>
    </div>
  )
}

import React, { useState, useEffect } from "react";
import { 
  FileText, 
  Plus, 
  Trash2, 
  Edit2, 
  Search, 
  CheckCircle, 
  Clock, 
  AlertCircle, 
  XCircle,
  Sparkles,
  Loader2,
  Printer
} from "lucide-react";
import { getRegulationReference } from "../services/geminiService";
import { db, collection, onSnapshot, doc, setDoc, deleteDoc, addDoc, updateDoc } from "../firebase";

type ReliefType = "Exemption" | "Extension";
type ReliefStatus = "Pending" | "Approved" | "Rejected" | "Expired";

type ExemptionRecord = {
  id: string;
  vesselName: string;
  imoNumber: string;
  type: ReliefType;
  description: string;
  regulationRef?: string;
  validFrom: string; // YYYY-MM-DD
  validTo: string;   // YYYY-MM-DD
  status: ReliefStatus;
  remarks?: string;
};

const ShipExemptions = () => {
  const [records, setRecords] = useState<ExemptionRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isFindingRef, setIsFindingRef] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [lastAnalyzedDesc, setLastAnalyzedDesc] = useState("");

  const [form, setForm] = useState<Omit<ExemptionRecord, "id">>({
    vesselName: "",
    imoNumber: "",
    type: "Exemption",
    description: "",
    regulationRef: "",
    validFrom: "",
    validTo: "",
    status: "Pending",
    remarks: ""
  });

  // Load from Firestore
  useEffect(() => {
    const unsub = onSnapshot(collection(db, "exemptions"), (snapshot) => {
      if (snapshot.empty) {
        // Default data
        const initialData: Omit<ExemptionRecord, "id">[] = [
          {
            vesselName: "Caribbean Queen",
            imoNumber: "9876543",
            type: "Exemption",
            description: "Exemption from carriage of fast rescue boat due to limited service area around Jamaica.",
            regulationRef: "SOLAS Chapter III, Regulation 20.1.1 (SOLAS): Applies to ships operating in restricted areas.",
            validFrom: "2025-01-01",
            validTo: "2026-01-01",
            status: "Approved",
            remarks: "Subject to annual verification."
          }
        ];
        initialData.forEach(async (rec) => {
          await addDoc(collection(db, "exemptions"), rec);
        });
      } else {
        const data = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data()
        })) as ExemptionRecord[];
        setRecords(data);
      }
      setIsLoaded(true);
    });

    return () => unsub();
  }, []);

  const resetForm = () => {
    setForm({
      vesselName: "",
      imoNumber: "",
      type: "Exemption",
      description: "",
      regulationRef: "",
      validFrom: "",
      validTo: "",
      status: "Pending",
      remarks: ""
    });
    setEditingId(null);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>
  ) => {
    const { name, value } = e.target;
    if (name === "description" && value === "") {
      setLastAnalyzedDesc("");
    }
    setForm(prev => ({ ...prev, [name]: value }));
  };

  const handleFindRegulation = async () => {
    if (!form.description || form.description === lastAnalyzedDesc) {
      return;
    }
    setIsFindingRef(true);
    try {
      const ref = await getRegulationReference(form.description);
      if (ref) {
        setForm(prev => ({ ...prev, regulationRef: ref }));
        setLastAnalyzedDesc(form.description);
      } else {
        alert("Could not find a specific regulation reference. Please try a more detailed description.");
      }
    } catch (error) {
      console.error(error);
    } finally {
      setIsFindingRef(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.vesselName || !form.imoNumber || !form.description) {
      alert("Vessel name, IMO number and description are required.");
      return;
    }

    try {
      if (editingId === null) {
        await addDoc(collection(db, "exemptions"), form);
      } else {
        await updateDoc(doc(db, "exemptions", editingId), form);
      }
      resetForm();
      setLastAnalyzedDesc("");
    } catch (err) {
      console.error("Error saving exemption:", err);
      alert("Failed to save record.");
    }
  };

  const handleEdit = (rec: ExemptionRecord) => {
    setEditingId(rec.id);
    setForm({
      vesselName: rec.vesselName,
      imoNumber: rec.imoNumber,
      type: rec.type,
      description: rec.description,
      regulationRef: rec.regulationRef || "",
      validFrom: rec.validFrom,
      validTo: rec.validTo,
      status: rec.status,
      remarks: rec.remarks ?? ""
    });
    setLastAnalyzedDesc(rec.description);
    // Scroll the main content area to the top
    const mainContent = document.querySelector('main');
    if (mainContent) {
      mainContent.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteDoc(doc(db, "exemptions", id));
      if (editingId === id) {
        resetForm();
      }
      setDeleteConfirmId(null);
    } catch (err) {
      console.error("Error deleting exemption:", err);
      alert("Failed to delete record.");
    }
  };

  const getStatusIcon = (status: ReliefStatus) => {
    switch (status) {
      case "Approved": return <CheckCircle size={16} className="text-green-500" />;
      case "Pending": return <Clock size={16} className="text-amber-500" />;
      case "Rejected": return <XCircle size={16} className="text-red-500" />;
      case "Expired": return <AlertCircle size={16} className="text-gray-400" />;
    }
  };

  const getStatusClass = (status: ReliefStatus) => {
    switch (status) {
      case "Approved": return "bg-green-50 text-green-700 border-green-100";
      case "Pending": return "bg-amber-50 text-amber-700 border-amber-100";
      case "Rejected": return "bg-red-50 text-red-700 border-red-100";
      case "Expired": return "bg-gray-50 text-gray-700 border-gray-100";
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold text-navy-900 flex items-center gap-2">
            <FileText className="text-navy-900" /> Ship Exemptions & Extensions
          </h2>
          <p className="text-gray-500 mt-1">
            Manage and track regulatory relief granted to MAJ-registered vessels.
          </p>
        </div>
      </div>

      {/* FORM SECTION */}
      <div className={`bg-white rounded-xl shadow-sm border transition-all duration-300 overflow-hidden ${editingId !== null ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-200'}`}>
        <div className={`${editingId !== null ? 'bg-blue-50' : 'bg-gray-50'} px-6 py-4 border-b border-gray-200 flex justify-between items-center`}>
          <h3 className={`font-bold flex items-center gap-2 ${editingId !== null ? 'text-blue-800' : 'text-gray-800'}`}>
            {editingId === null ? <Plus size={18} /> : <Edit2 size={18} />}
            {editingId === null ? "Register New Relief" : `Editing Record #${editingId}`}
          </h3>
          {editingId !== null && (
            <button 
              onClick={resetForm} 
              className="text-sm bg-white border border-blue-200 text-blue-600 px-3 py-1 rounded-md hover:bg-blue-100 transition"
            >
              Cancel Editing
            </button>
          )}
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">Vessel Name *</label>
              <input
                required
                name="vesselName"
                value={form.vesselName}
                onChange={handleChange}
                placeholder="e.g. MV Kingston"
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navy-500 focus:border-navy-500 outline-none transition"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">IMO Number *</label>
              <input
                required
                name="imoNumber"
                value={form.imoNumber}
                onChange={handleChange}
                placeholder="7-digit number"
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navy-500 focus:border-navy-500 outline-none transition"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">Relief Type</label>
              <select 
                name="type" 
                value={form.type} 
                onChange={handleChange}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navy-500 focus:border-navy-500 outline-none transition"
              >
                <option value="Exemption">Exemption</option>
                <option value="Extension">Extension</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">Status</label>
              <select 
                name="status" 
                value={form.status} 
                onChange={handleChange}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navy-500 focus:border-navy-500 outline-none transition"
              >
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
                <option value="Expired">Expired</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">Valid From</label>
              <input
                type="date"
                name="validFrom"
                value={form.validFrom}
                onChange={handleChange}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navy-500 focus:border-navy-500 outline-none transition"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-sm font-semibold text-gray-700">Valid To</label>
              <input
                type="date"
                name="validTo"
                value={form.validTo}
                onChange={handleChange}
                className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navy-500 focus:border-navy-500 outline-none transition"
              />
            </div>
          </div>

          <div className="space-y-1">
            <div className="flex justify-between items-center">
              <label className="block text-sm font-semibold text-gray-700">Description of Relief *</label>
              <div className="flex items-center gap-2">
                {isFindingRef && (
                  <span className="text-[10px] text-navy-500 animate-pulse flex items-center gap-1">
                    <Loader2 size={10} className="animate-spin" />
                    AI Analyzing...
                  </span>
                )}
                <button 
                  type="button"
                  onClick={handleFindRegulation}
                  disabled={isFindingRef || !form.description || form.description === lastAnalyzedDesc}
                  className="text-xs font-bold text-navy-600 hover:text-navy-800 flex items-center gap-1 bg-navy-50 px-2 py-1 rounded border border-navy-100 disabled:opacity-50"
                >
                  <Sparkles size={12} />
                  Manual Refresh
                </button>
              </div>
            </div>
            <textarea
              name="description"
              value={form.description}
              onChange={handleChange}
              onBlur={() => {
                if (form.description.length > 10 && form.description !== lastAnalyzedDesc && !isFindingRef) {
                  handleFindRegulation();
                }
              }}
              rows={3}
              placeholder="Describe the exemption or extension request in detail..."
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navy-500 focus:border-navy-500 outline-none transition"
            />
            <p className="text-[10px] text-gray-400 italic mt-1">
              * Regulation reference will be auto-generated when you finish typing and move to the next field.
            </p>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-semibold text-gray-700">Regulation Reference (Auto-Generated)</label>
            <div className="relative">
              <input
                name="regulationRef"
                value={form.regulationRef}
                onChange={handleChange}
                placeholder={isFindingRef ? "AI is searching conventions..." : "e.g. SOLAS Chapter II-2, Regulation 10"}
                className={`w-full p-2.5 border rounded-lg italic text-navy-900 transition-all ${isFindingRef ? 'bg-navy-50 border-navy-200 animate-pulse' : 'bg-gray-50 border-gray-300'}`}
              />
              {isFindingRef && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <Loader2 size={16} className="animate-spin text-navy-400" />
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <label className="block text-sm font-semibold text-gray-700">Remarks / Conditions</label>
            <textarea
              name="remarks"
              value={form.remarks}
              onChange={handleChange}
              rows={2}
              placeholder="Any specific conditions or internal notes..."
              className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-navy-500 focus:border-navy-500 outline-none transition"
            />
          </div>

          <div className="flex justify-end pt-4">
            <button 
              type="submit"
              className="bg-navy-900 text-white px-8 py-3 rounded-lg font-bold hover:bg-navy-800 transition shadow-lg flex items-center gap-2"
            >
              {editingId === null ? <Plus size={20} /> : <CheckCircle size={20} />}
              {editingId === null ? "Register Record" : "Update Record"}
            </button>
          </div>
        </form>
      </div>

      {/* LIST SECTION */}
      <div id="print-area-exemptions" className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center print:bg-white print:border-none">
          <h3 className="font-bold text-gray-800 flex items-center gap-2">
            <Search size={18} /> Active Relief Registry
          </h3>
          <button
            onClick={() => window.print()}
            className="flex items-center gap-2 bg-navy-100 text-navy-700 px-4 py-2 rounded-lg hover:bg-navy-200 transition font-bold text-sm print:hidden"
          >
            <Printer size={18} />
            Print Registry
          </button>
        </div>

        <div className="hidden print:block p-8 text-center border-b border-gray-200">
          <h1 className="text-2xl font-bold text-navy-900">MARITIME AUTHORITY OF JAMAICA</h1>
          <p className="text-gray-600">Official Relief & Exemption Registry</p>
          <p className="text-xs text-gray-400 mt-2">Generated on {new Date().toLocaleDateString()} {new Date().toLocaleTimeString()}</p>
        </div>
        
        <div className="overflow-x-auto print:overflow-visible">
          <table className="w-full text-left border-collapse">
            <thead className="bg-gray-100 text-gray-600 text-xs uppercase tracking-wider">
              <tr>
                <th className="px-6 py-4 font-bold">Vessel / IMO</th>
                <th className="px-6 py-4 font-bold">Type</th>
                <th className="px-6 py-4 font-bold">Validity</th>
                <th className="px-6 py-4 font-bold">Status</th>
                <th className="px-6 py-4 font-bold">Details</th>
                <th className="px-6 py-4 font-bold text-right print:hidden">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-gray-500 italic">
                    No exemption or extension records found.
                  </td>
                </tr>
              ) : (
                records.map(rec => (
                  <tr key={rec.id} className="hover:bg-gray-50 transition">
                    <td className="px-6 py-4">
                      <p className="font-bold text-navy-900">{rec.vesselName}</p>
                      <p className="text-xs text-gray-500">IMO: {rec.imoNumber}</p>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`px-2 py-1 rounded text-xs font-bold ${rec.type === 'Exemption' ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                        {rec.type}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs space-y-1">
                        <p><span className="text-gray-400">From:</span> {rec.validFrom || 'N/A'}</p>
                        <p><span className="text-gray-400">To:</span> {rec.validTo || 'N/A'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-bold border ${getStatusClass(rec.status)}`}>
                        {getStatusIcon(rec.status)}
                        {rec.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 max-w-xs">
                      <p className="text-sm text-gray-700 line-clamp-2">{rec.description}</p>
                      {rec.regulationRef && (
                        <p className="text-[10px] text-navy-600 mt-1 font-medium italic truncate">
                          Ref: {rec.regulationRef}
                        </p>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right print:hidden">
                      <div className="flex justify-end gap-2">
                        {deleteConfirmId === rec.id ? (
                          <div className="flex items-center gap-1 animate-fade-in">
                            <span className="text-[10px] font-bold text-red-600 uppercase">Confirm?</span>
                            <button 
                              onClick={() => handleDelete(rec.id)}
                              className="p-1 bg-red-600 text-white rounded hover:bg-red-700 transition"
                            >
                              <CheckCircle size={14} />
                            </button>
                            <button 
                              onClick={() => setDeleteConfirmId(null)}
                              className="p-1 bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition"
                            >
                              <XCircle size={14} />
                            </button>
                          </div>
                        ) : (
                          <>
                            <button 
                              onClick={() => handleEdit(rec)}
                              className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition"
                              title="Edit"
                            >
                              <Edit2 size={18} />
                            </button>
                            <button 
                              onClick={() => setDeleteConfirmId(rec.id)}
                              className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
                              title="Delete"
                            >
                              <Trash2 size={18} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default ShipExemptions;

import React, { useState, useMemo, useEffect } from 'react';
import dataset from './data/processed_data.json';
import {
  Phone,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Search,
  Download,
  ShieldAlert,
  ChevronRight,
  X,
  FileText,
  User,
  Activity,
  Filter,
  Check,
  Building2,
  Stethoscope,
  Info,
  Copy,
  ExternalLink,
  ChevronDown,
  Layers,
  PhoneCall,
  Sparkles
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('OVERDUE'); // 'OVERDUE' | 'DUE_SOON' | 'CLINICAL_REVIEW' | 'EXCLUDED'
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('ALL'); // 'ALL' | 'HIGH' | 'MEDIUM'
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [dispositionFilter, setDispositionFilter] = useState('ALL'); // 'ALL' | 'PENDING' | 'COMPLETED'
  const [selectedMRN, setSelectedMRN] = useState(null);
  const [copiedPhone, setCopiedPhone] = useState(null);

  // Local storage for Call Outcomes and Front Desk Notes
  const [callRecords, setCallRecords] = useState(() => {
    try {
      const saved = localStorage.getItem('mera_call_records_v2');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const updateDisposition = (mrn, status) => {
    setCallRecords((prev) => {
      const updated = {
        ...prev,
        [mrn]: {
          ...(prev[mrn] || {}),
          status,
          updatedAt: new Date().toISOString()
        }
      };
      try {
        localStorage.setItem('mera_call_records_v2', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const updateCallNotes = (mrn, notes) => {
    setCallRecords((prev) => {
      const updated = {
        ...prev,
        [mrn]: {
          ...(prev[mrn] || {}),
          notes,
          updatedAt: new Date().toISOString()
        }
      };
      try {
        localStorage.setItem('mera_call_records_v2', JSON.stringify(updated));
      } catch (e) {
        console.error(e);
      }
      return updated;
    });
  };

  const copyToClipboard = (phone, e) => {
    e.stopPropagation();
    if (!phone) return;
    navigator.clipboard.writeText(phone);
    setCopiedPhone(phone);
    setTimeout(() => setCopiedPhone(null), 2000);
  };

  // Distinct Lists from Dataset
  const overdueList = useMemo(
    () => dataset.patients.filter((p) => p.worklist === 'OVERDUE'),
    []
  );
  const dueSoonList = useMemo(
    () => dataset.patients.filter((p) => p.worklist === 'DUE_SOON'),
    []
  );
  const reviewList = useMemo(
    () =>
      dataset.patients.filter(
        (p) =>
          p.worklist === 'CLINICAL_REVIEW' ||
          (p.is_lab_only_diagnosis && ['OVERDUE', 'DUE_SOON'].includes(p.worklist))
      ),
    []
  );
  const excludedList = useMemo(
    () => dataset.patients.filter((p) => p.worklist === 'EXCLUDED'),
    []
  );

  // Departments
  const departments = useMemo(() => {
    const set = new Set();
    dataset.patients.forEach((p) => {
      if (p.latest_visit && p.latest_visit.department) {
        set.add(p.latest_visit.department);
      }
    });
    return Array.from(set).sort();
  }, []);

  // Filtered List based on Current Tab and Controls
  const currentList = useMemo(() => {
    let list = [];
    if (activeTab === 'OVERDUE') list = overdueList;
    else if (activeTab === 'DUE_SOON') list = dueSoonList;
    else if (activeTab === 'CLINICAL_REVIEW') list = reviewList;
    else if (activeTab === 'EXCLUDED') list = excludedList;

    return list.filter((p) => {
      // Search
      if (searchTerm) {
        const q = searchTerm.toLowerCase();
        const matchName = p.name.toLowerCase().includes(q);
        const matchMRN = p.mrn.toLowerCase().includes(q);
        const matchPhone = p.phone.toLowerCase().includes(q);
        if (!matchName && !matchMRN && !matchPhone) return false;
      }

      // Priority
      if (activeTab === 'OVERDUE' && priorityFilter !== 'ALL') {
        if (p.priority !== priorityFilter) return false;
      }

      // Department
      if (departmentFilter !== 'ALL') {
        if (!p.latest_visit || p.latest_visit.department !== departmentFilter) {
          return false;
        }
      }

      // Call Disposition Status
      if (['OVERDUE', 'DUE_SOON'].includes(activeTab) && dispositionFilter !== 'ALL') {
        const currentDisp = callRecords[p.mrn]?.status || 'PENDING';
        if (dispositionFilter === 'PENDING' && currentDisp !== 'PENDING') return false;
        if (dispositionFilter === 'COMPLETED' && currentDisp === 'PENDING') return false;
      }

      return true;
    });
  }, [
    activeTab,
    searchTerm,
    priorityFilter,
    departmentFilter,
    dispositionFilter,
    callRecords,
    overdueList,
    dueSoonList,
    reviewList,
    excludedList
  ]);

  // Selected Patient Details for Slide-Over Drawer
  const selectedPatient = useMemo(() => {
    if (!selectedMRN) return null;
    return dataset.patients.find((p) => p.mrn === selectedMRN) || null;
  }, [selectedMRN]);

  // Calculate age as of reference date
  const computeAge = (dobStr) => {
    if (!dobStr) return '';
    try {
      const dob = new Date(dobStr);
      const ref = new Date(dataset.reference_date);
      let age = ref.getFullYear() - dob.getFullYear();
      const m = ref.getMonth() - dob.getMonth();
      if (m < 0 || (m === 0 && ref.getDate() < dob.getDate())) {
        age--;
      }
      return `${age}y`;
    } catch {
      return '';
    }
  };

  // CSV Export handler
  const handleExportCSV = () => {
    const filename =
      activeTab === 'OVERDUE'
        ? 'overdue_diabetic_patients.csv'
        : activeTab === 'DUE_SOON'
        ? 'due_soon_diabetic_patients.csv'
        : activeTab === 'CLINICAL_REVIEW'
        ? 'clinical_review_diabetic_patients.csv'
        : 'excluded_patients.csv';

    const headers = [
      'MRN',
      'Name',
      'Phone',
      'Call Disposition',
      'Priority',
      activeTab === 'DUE_SOON' ? 'Days Remaining' : 'Days Overdue',
      'Target Date',
      'Reason For Call',
      'Clinical Evidence',
      'Action & Safety Flags',
      'Last Visit Date',
      'Last Department',
      'Last Doctor',
      'Front Desk Notes'
    ];

    const rows = currentList.map((p) => [
      `"${p.mrn}"`,
      `"${p.name}"`,
      `"${p.phone || 'NO_PHONE'}"`,
      `"${callRecords[p.mrn]?.status || 'PENDING'}"`,
      `"${p.priority}"`,
      activeTab === 'DUE_SOON' ? p.days_until : p.days_overdue,
      `"${p.target_date}"`,
      `"${p.reason_summary}"`,
      `"${(p.clinical_evidence || []).join('; ')}"`,
      `"${(p.warning_flags || []).join('; ')}"`,
      `"${p.latest_visit ? p.latest_visit.visit_date : ''}"`,
      `"${p.latest_visit ? p.latest_visit.department : ''}"`,
      `"${p.latest_visit ? p.latest_visit.doctor : ''}"`,
      `"${callRecords[p.mrn]?.notes || ''}"`
    ]);

    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Progress stats
  const highPriorityTotal = overdueList.filter((p) => p.priority === 'HIGH').length;
  const overdueCompletedCount = overdueList.filter(
    (p) => (callRecords[p.mrn]?.status || 'PENDING') !== 'PENDING'
  ).length;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-canvas)' }}>
      {/* Top Professional Hospital Header */}
      <header
        style={{
          background: 'var(--bg-surface)',
          borderBottom: '1px solid var(--border-medium)',
          position: 'sticky',
          top: 0,
          zIndex: 40,
          boxShadow: 'var(--shadow-sm)'
        }}
      >
        <div
          style={{
            maxWidth: 1440,
            margin: '0 auto',
            padding: '12px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 16
          }}
        >
          {/* Hospital Identity */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 8,
                background: '#1e3a8a',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 2px 6px rgba(30, 58, 138, 0.25)'
              }}
            >
              <Activity size={20} strokeWidth={2.5} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                  St. Vincent Hospital
                </span>
                <span className="badge badge-outline" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  OPD Front Desk
                </span>
                <span className="badge badge-purple" style={{ fontSize: '0.7rem' }}>
                  mera.health
                </span>
              </div>
              <p style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                Diabetic Patient Follow-Up & Call Recall System
              </p>
            </div>
          </div>

          {/* Operational Metrics & As-Of Date */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            {/* Progress Counter */}
            <div
              style={{
                background: 'var(--bg-subtle)',
                border: '1px solid var(--border-light)',
                borderRadius: 8,
                padding: '6px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 12
              }}
            >
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>
                  Calls Completed
                </div>
                <div style={{ fontSize: '0.88rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {overdueCompletedCount} <span style={{ color: 'var(--text-dim)', fontWeight: 500 }}>/ {overdueList.length}</span>
                </div>
              </div>
              <div style={{ width: 48, height: 6, background: 'var(--border-medium)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${(overdueCompletedCount / (overdueList.length || 1)) * 100}%`,
                    height: '100%',
                    background: '#10b981',
                    borderRadius: 3,
                    transition: 'width 0.3s ease'
                  }}
                />
              </div>
            </div>

            {/* Reference Date Indicator */}
            <div
              style={{
                background: 'var(--primary-subtle)',
                border: '1px solid var(--primary-border)',
                borderRadius: 8,
                padding: '6px 12px',
                display: 'flex',
                alignItems: 'center',
                gap: 6
              }}
            >
              <Calendar size={14} color="#2563eb" />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>System Date:</span>
              <span className="mono" style={{ fontSize: '0.8rem', fontWeight: 700, color: '#1d4ed8' }}>
                {dataset.reference_date}
              </span>
            </div>

            {/* Export Button */}
            <button
              onClick={handleExportCSV}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: activeTab === 'DUE_SOON' ? '#059669' : '#1e3a8a',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: '0.82rem',
                fontWeight: 600,
                boxShadow: 'var(--shadow-sm)',
                transition: 'background 0.15s ease'
              }}
            >
              <Download size={14} />
              {activeTab === 'OVERDUE'
                ? 'Export Overdue List (CSV)'
                : activeTab === 'DUE_SOON'
                ? 'Export Due Soon List (CSV)'
                : 'Export Worklist (CSV)'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <div style={{ maxWidth: 1440, margin: '0 auto', width: '100%', padding: '20px 24px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Navigation Tabs Bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--border-medium)',
            marginBottom: 16,
            gap: 12,
            overflowX: 'auto'
          }}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Overdue Call List Tab */}
            <button
              onClick={() => {
                setActiveTab('OVERDUE');
                setSelectedMRN(null);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                fontSize: '0.88rem',
                fontWeight: activeTab === 'OVERDUE' ? 700 : 500,
                color: activeTab === 'OVERDUE' ? 'var(--urgent-text)' : 'var(--text-secondary)',
                borderBottom: activeTab === 'OVERDUE' ? '2.5px solid #dc2626' : '2.5px solid transparent',
                background: activeTab === 'OVERDUE' ? 'var(--urgent-bg)' : 'transparent',
                borderRadius: '8px 8px 0 0',
                transition: 'all 0.15s ease'
              }}
            >
              <PhoneCall size={16} color={activeTab === 'OVERDUE' ? '#dc2626' : '#64748b'} />
              <span>Overdue Call List</span>
              <span
                style={{
                  background: activeTab === 'OVERDUE' ? '#dc2626' : 'var(--bg-subtle)',
                  color: activeTab === 'OVERDUE' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: 12,
                  padding: '1px 8px',
                  fontSize: '0.72rem',
                  fontWeight: 700
                }}
              >
                {overdueList.length}
              </span>
              <span className="badge badge-urgent" style={{ fontSize: '0.65rem' }}>
                {highPriorityTotal} High Risk
              </span>
            </button>

            {/* Due Soon Reminder List Tab */}
            <button
              onClick={() => {
                setActiveTab('DUE_SOON');
                setSelectedMRN(null);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                fontSize: '0.88rem',
                fontWeight: activeTab === 'DUE_SOON' ? 700 : 500,
                color: activeTab === 'DUE_SOON' ? 'var(--success-text)' : 'var(--text-secondary)',
                borderBottom: activeTab === 'DUE_SOON' ? '2.5px solid #059669' : '2.5px solid transparent',
                background: activeTab === 'DUE_SOON' ? 'var(--success-bg)' : 'transparent',
                borderRadius: '8px 8px 0 0',
                transition: 'all 0.15s ease'
              }}
            >
              <Clock size={16} color={activeTab === 'DUE_SOON' ? '#059669' : '#64748b'} />
              <span>Due Soon Reminder List</span>
              <span
                style={{
                  background: activeTab === 'DUE_SOON' ? '#059669' : 'var(--bg-subtle)',
                  color: activeTab === 'DUE_SOON' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: 12,
                  padding: '1px 8px',
                  fontSize: '0.72rem',
                  fontWeight: 700
                }}
              >
                {dueSoonList.length}
              </span>
              <span className="badge badge-success" style={{ fontSize: '0.65rem' }}>
                Next 14 Days
              </span>
            </button>

            {/* Clinical Review Tab */}
            <button
              onClick={() => {
                setActiveTab('CLINICAL_REVIEW');
                setSelectedMRN(null);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                fontSize: '0.88rem',
                fontWeight: activeTab === 'CLINICAL_REVIEW' ? 700 : 500,
                color: activeTab === 'CLINICAL_REVIEW' ? 'var(--purple-text)' : 'var(--text-secondary)',
                borderBottom: activeTab === 'CLINICAL_REVIEW' ? '2.5px solid #7c3aed' : '2.5px solid transparent',
                background: activeTab === 'CLINICAL_REVIEW' ? 'var(--purple-bg)' : 'transparent',
                borderRadius: '8px 8px 0 0',
                transition: 'all 0.15s ease'
              }}
            >
              <Stethoscope size={16} color={activeTab === 'CLINICAL_REVIEW' ? '#7c3aed' : '#64748b'} />
              <span>Clinical Review Queue</span>
              <span
                style={{
                  background: activeTab === 'CLINICAL_REVIEW' ? '#7c3aed' : 'var(--bg-subtle)',
                  color: activeTab === 'CLINICAL_REVIEW' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: 12,
                  padding: '1px 8px',
                  fontSize: '0.72rem',
                  fontWeight: 700
                }}
              >
                {reviewList.length}
              </span>
            </button>

            {/* Excluded Guardrails Tab */}
            <button
              onClick={() => {
                setActiveTab('EXCLUDED');
                setSelectedMRN(null);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '10px 18px',
                fontSize: '0.88rem',
                fontWeight: activeTab === 'EXCLUDED' ? 700 : 500,
                color: activeTab === 'EXCLUDED' ? 'var(--text-primary)' : 'var(--text-secondary)',
                borderBottom: activeTab === 'EXCLUDED' ? '2.5px solid #475569' : '2.5px solid transparent',
                background: activeTab === 'EXCLUDED' ? 'var(--slate-bg)' : 'transparent',
                borderRadius: '8px 8px 0 0',
                transition: 'all 0.15s ease'
              }}
            >
              <ShieldAlert size={16} color={activeTab === 'EXCLUDED' ? '#475569' : '#64748b'} />
              <span>Excluded / Do Not Call</span>
              <span
                style={{
                  background: activeTab === 'EXCLUDED' ? '#475569' : 'var(--bg-subtle)',
                  color: activeTab === 'EXCLUDED' ? '#fff' : 'var(--text-secondary)',
                  borderRadius: 12,
                  padding: '1px 8px',
                  fontSize: '0.72rem',
                  fontWeight: 700
                }}
              >
                {excludedList.length}
              </span>
            </button>
          </div>
        </div>

        {/* Action / Context Directive Alert */}
        <div
          style={{
            background:
              activeTab === 'OVERDUE'
                ? '#fff1f2'
                : activeTab === 'DUE_SOON'
                ? '#f0fdf4'
                : activeTab === 'CLINICAL_REVIEW'
                ? '#faf5ff'
                : '#f8fafc',
            border: `1px solid ${
              activeTab === 'OVERDUE'
                ? '#fecdd3'
                : activeTab === 'DUE_SOON'
                ? '#bbf7d0'
                : activeTab === 'CLINICAL_REVIEW'
                ? '#e9d5ff'
                : '#cbd5e1'
            }`,
            borderRadius: 8,
            padding: '10px 16px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontSize: '0.82rem'
          }}
        >
          <Info size={16} color="currentColor" style={{ flexShrink: 0 }} />
          <div>
            {activeTab === 'OVERDUE' && (
              <span>
                <strong>Front Desk Directive:</strong> Call overdue patients to book follow-up visits.
              </span>
            )}
            {activeTab === 'DUE_SOON' && (
              <span>
                <strong>Front Desk Directive:</strong> Preventive reminder calls. These patients have scheduled appointments or review targets within the next 14 days or are approaching 4 months. Calling them now prevents missed appointments.
              </span>
            )}
            {activeTab === 'CLINICAL_REVIEW' && (
              <span>
                <strong>Doctor Directive:</strong> Review before calling. These patients had abnormal screening lab tests (or borderline prediabetes) but lack an OPD diagnosis note. Confirm diagnosis before front desk initiates contact.
              </span>
            )}
            {activeTab === 'EXCLUDED' && (
              <span>
                <strong>Audit Directive:</strong> 3 deceased patients, 3 transferred-care patients, and confirmed non-diabetic screening patients are protected here with full clinical documentation.
              </span>
            )}
          </div>
        </div>

        {/* Filter Controls Toolbar */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 16,
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 12,
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          {/* Search Input */}
          <div style={{ position: 'relative', flex: '1 1 280px' }}>
            <Search
              size={15}
              color="var(--text-muted)"
              style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }}
            />
            <input
              type="text"
              placeholder="Search by patient name, MRN, phone number..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                background: 'var(--bg-canvas)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                padding: '7px 10px 7px 32px',
                borderRadius: 6,
                fontSize: '0.82rem',
                outline: 'none'
              }}
            />
          </div>

          {/* Priority Filter (Overdue tab) */}
          {activeTab === 'OVERDUE' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Priority:</span>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                style={{
                  background: 'var(--bg-canvas)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: '0.8rem',
                  fontWeight: 500
                }}
              >
                <option value="ALL">All Priorities</option>
                <option value="HIGH">🔴 High Priority ({highPriorityTotal})</option>
                <option value="MEDIUM">🟡 Medium Priority ({overdueList.length - highPriorityTotal})</option>
              </select>
            </div>
          )}

          {/* Call Status Filter */}
          {['OVERDUE', 'DUE_SOON'].includes(activeTab) && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Call Status:</span>
              <select
                value={dispositionFilter}
                onChange={(e) => setDispositionFilter(e.target.value)}
                style={{
                  background: 'var(--bg-canvas)',
                  border: '1px solid var(--border-medium)',
                  color: 'var(--text-primary)',
                  padding: '6px 10px',
                  borderRadius: 6,
                  fontSize: '0.8rem',
                  fontWeight: 500
                }}
              >
                <option value="ALL">All Statuses</option>
                <option value="PENDING">Pending Call</option>
                <option value="COMPLETED">Call Handled</option>
              </select>
            </div>
          )}

          {/* Department Filter */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>Department:</span>
            <select
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
              style={{
                background: 'var(--bg-canvas)',
                border: '1px solid var(--border-medium)',
                color: 'var(--text-primary)',
                padding: '6px 10px',
                borderRadius: 6,
                fontSize: '0.8rem',
                fontWeight: 500
              }}
            >
              <option value="ALL">All Specialties</option>
              {departments.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>

          {/* Matching Count */}
          <div style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Showing <strong>{currentList.length}</strong> records
          </div>
        </div>

        {/* Data Table Workspace */}
        <div
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-medium)',
            borderRadius: 8,
            overflow: 'hidden',
            boxShadow: 'var(--shadow-sm)'
          }}
        >
          <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 360px)' }}>
            <table className="clinical-table">
              <thead>
                <tr>
                  <th style={{ width: 140 }}>Call Outcome</th>
                  <th style={{ width: 120 }}>{activeTab === 'DUE_SOON' ? 'Status' : 'Priority'}</th>
                  <th style={{ width: 220 }}>Patient Details</th>
                  <th style={{ width: 160 }}>Phone & Actions</th>
                  <th>Trigger / Reason For Follow-Up</th>
                  <th style={{ width: 180 }}>Last Visit Info</th>
                  <th style={{ width: 80, textAlign: 'center' }}>Dossier</th>
                </tr>
              </thead>
              <tbody>
                {currentList.length === 0 ? (
                  <tr>
                    <td colSpan={7} style={{ textAlign: 'center', padding: '40px 16px', color: 'var(--text-muted)' }}>
                      No patients match your search or filter parameters.
                    </td>
                  </tr>
                ) : (
                  currentList.map((patient) => {
                    const isSelected = selectedMRN === patient.mrn;
                    const disp = callRecords[patient.mrn]?.status || 'PENDING';
                    const isCompleted = disp !== 'PENDING';

                    return (
                      <tr
                        key={patient.mrn}
                        className={isSelected ? 'selected' : ''}
                        onClick={() => setSelectedMRN(patient.mrn)}
                        style={{ cursor: 'pointer' }}
                      >
                        {/* Call Outcome Selector */}
                        <td onClick={(e) => e.stopPropagation()}>
                          {['OVERDUE', 'DUE_SOON'].includes(activeTab) ? (
                            <select
                              value={disp}
                              onChange={(e) => updateDisposition(patient.mrn, e.target.value)}
                              style={{
                                width: '100%',
                                fontSize: '0.75rem',
                                padding: '4px 6px',
                                borderRadius: 5,
                                border: '1px solid var(--border-medium)',
                                fontWeight: 600,
                                background:
                                  disp === 'BOOKED'
                                    ? '#dcfce7'
                                    : disp === 'VOICEMAIL'
                                    ? '#fef3c7'
                                    : disp === 'CALLBACK'
                                    ? '#e0e7ff'
                                    : disp === 'WRONG_NUMBER'
                                    ? '#fee2e2'
                                    : '#f8fafc',
                                color:
                                  disp === 'BOOKED'
                                    ? '#15803d'
                                    : disp === 'VOICEMAIL'
                                    ? '#b45309'
                                    : disp === 'CALLBACK'
                                    ? '#4338ca'
                                    : disp === 'WRONG_NUMBER'
                                    ? '#b91c1c'
                                    : 'var(--text-secondary)'
                              }}
                            >
                              <option value="PENDING">⏳ To Call</option>
                              <option value="BOOKED">✅ Booked / Rescheduled</option>
                              <option value="VOICEMAIL">📩 Voicemail / Left Msg</option>
                              <option value="CALLBACK">🔄 Callback Requested</option>
                              <option value="WRONG_NUMBER">❌ Wrong / Inactive</option>
                            </select>
                          ) : (
                            <span className="badge badge-slate" style={{ fontSize: '0.7rem' }}>
                              {patient.worklist}
                            </span>
                          )}
                        </td>

                        {/* Priority / Time Metric */}
                        <td>
                          {activeTab === 'OVERDUE' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              {patient.priority === 'HIGH' ? (
                                <span className="badge badge-urgent">
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                                  High Priority
                                </span>
                              ) : (
                                <span className="badge badge-medium">
                                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#f59e0b' }} />
                                  Medium Priority
                                </span>
                              )}
                              <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                {patient.days_overdue}d overdue
                              </span>
                            </div>
                          )}

                          {activeTab === 'DUE_SOON' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                              <span className="badge badge-success">
                                <Clock size={11} /> Due in {patient.days_until}d
                              </span>
                              <span className="mono" style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                Target: {patient.target_date}
                              </span>
                            </div>
                          )}

                          {activeTab === 'CLINICAL_REVIEW' && (
                            <span className="badge badge-purple">
                              <Stethoscope size={11} /> Review
                            </span>
                          )}

                          {activeTab === 'EXCLUDED' && (
                            <span className="badge badge-slate">
                              <ShieldAlert size={11} /> Protected
                            </span>
                          )}
                        </td>

                        {/* Patient Core Identifiers */}
                        <td>
                          <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.9rem' }}>
                                {patient.name}
                              </span>
                              <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                ({patient.sex}, {computeAge(patient.dob)})
                              </span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                              <span className="mono badge badge-outline" style={{ fontSize: '0.7rem' }}>
                                {patient.mrn}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Phone with Click-to-Call and Copy */}
                        <td onClick={(e) => e.stopPropagation()}>
                          {patient.phone ? (
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <a
                                href={`tel:${patient.phone}`}
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  color: 'var(--primary)',
                                  textDecoration: 'none',
                                  fontWeight: 600,
                                  fontSize: '0.82rem'
                                }}
                              >
                                <Phone size={13} />
                                <span className="mono">{patient.phone}</span>
                              </a>
                              <button
                                onClick={(e) => copyToClipboard(patient.phone, e)}
                                title="Copy phone number"
                                style={{
                                  padding: 4,
                                  borderRadius: 4,
                                  color: copiedPhone === patient.phone ? '#10b981' : 'var(--text-muted)',
                                  background: 'var(--bg-canvas)'
                                }}
                              >
                                {copiedPhone === patient.phone ? <Check size={12} /> : <Copy size={12} />}
                              </button>
                            </div>
                          ) : (
                            <span className="badge badge-urgent" style={{ fontSize: '0.7rem' }}>
                              <AlertTriangle size={11} /> No Phone
                            </span>
                          )}
                        </td>

                        {/* Compact Tokenized Reason Box & Safety Flags */}
                        <td>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                            {/* Structured Reason Tokens */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                              {patient.reason_tokens && patient.reason_tokens.length > 0 ? (
                                patient.reason_tokens.map((tok, i) => (
                                  <span
                                    key={i}
                                    style={{
                                      fontSize: '0.74rem',
                                      fontWeight: i === 0 ? 700 : 500,
                                      padding: '2px 7px',
                                      borderRadius: 4,
                                      background:
                                        i === 0
                                          ? activeTab === 'DUE_SOON'
                                            ? 'var(--success-bg)'
                                            : 'var(--urgent-bg)'
                                          : 'var(--bg-subtle)',
                                      color:
                                        i === 0
                                          ? activeTab === 'DUE_SOON'
                                            ? 'var(--success-text)'
                                            : 'var(--urgent-text)'
                                          : 'var(--text-secondary)',
                                      border:
                                        i === 0
                                          ? activeTab === 'DUE_SOON'
                                            ? '1px solid var(--success-border)'
                                            : '1px solid var(--urgent-border)'
                                          : '1px solid var(--border-light)'
                                    }}
                                  >
                                    {tok}
                                  </span>
                                ))
                              ) : (
                                <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                  {patient.exclusion_reason}
                                </span>
                              )}
                            </div>

                            {/* Prominent Action & Safety Flags */}
                            {patient.warning_flags && patient.warning_flags.length > 0 && (
                              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                                {patient.warning_flags.map((flag, idx) => {
                                  const isNonDiab = flag.startsWith('Recent Non-Diabetic Visit');
                                  const isDup = flag.startsWith('Duplicate Registration');
                                  const isShared = flag.startsWith('Shared Family Phone');
                                  const isLabOnly = flag.startsWith('Lab Diagnosis Only');

                                  let cls = 'badge-medium';
                                  if (isDup) cls = 'badge-urgent';
                                  if (isShared) cls = 'badge-slate';
                                  if (isLabOnly) cls = 'badge-purple';
                                  if (isNonDiab) cls = 'badge-medium';

                                  return (
                                    <span key={idx} className={`badge ${cls}`} style={{ fontSize: '0.68rem' }}>
                                      <AlertTriangle size={10} />
                                      {flag}
                                    </span>
                                  );
                                })}
                              </div>
                            )}

                            {/* Clinical Evidence Summary */}
                            {patient.clinical_evidence && patient.clinical_evidence.length > 0 && (
                              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                Evidence: {patient.clinical_evidence.join(' • ')}
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Last Visit */}
                        <td>
                          {patient.latest_visit ? (
                            <div style={{ fontSize: '0.78rem' }}>
                              <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                {patient.latest_visit.visit_date}
                              </div>
                              <div style={{ color: 'var(--text-secondary)', fontSize: '0.72rem' }}>
                                {patient.latest_visit.department}
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.7rem' }}>
                                {patient.latest_visit.doctor}
                              </div>
                            </div>
                          ) : (
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>None</span>
                          )}
                        </td>

                        {/* Dossier Action Arrow */}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            title="Inspect Clinical Dossier"
                            style={{
                              padding: 6,
                              borderRadius: 6,
                              color: isSelected ? 'var(--primary)' : 'var(--text-muted)',
                              background: isSelected ? 'var(--primary-subtle)' : 'transparent'
                            }}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Slide-Over Clinical Dossier Drawer */}
      {selectedPatient && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'flex',
            justifyContent: 'flex-end',
            background: 'rgba(15, 23, 42, 0.4)',
            backdropFilter: 'blur(3px)'
          }}
          onClick={() => setSelectedMRN(null)}
        >
          <div
            className="slide-in-right"
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 580,
              background: 'var(--bg-surface)',
              height: '100%',
              boxShadow: 'var(--shadow-drawer)',
              borderLeft: '1px solid var(--border-medium)',
              display: 'flex',
              flexDirection: 'column',
              overflowY: 'auto'
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: '20px 24px',
                borderBottom: '1px solid var(--border-light)',
                background: 'var(--bg-subtle)',
                position: 'sticky',
                top: 0,
                zIndex: 10,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start'
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <h2 style={{ fontSize: '1.2rem', fontWeight: 800, color: 'var(--text-primary)' }}>
                    {selectedPatient.name}
                  </h2>
                  <span className="mono badge badge-outline">{selectedPatient.mrn}</span>
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                  {selectedPatient.sex} • DOB: {selectedPatient.dob} ({computeAge(selectedPatient.dob)}) • Registered: {selectedPatient.registered_on}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  {selectedPatient.phone ? (
                    <a
                      href={`tel:${selectedPatient.phone}`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        color: 'var(--primary)',
                        textDecoration: 'none',
                        fontWeight: 700,
                        fontSize: '0.9rem'
                      }}
                    >
                      <Phone size={14} />
                      <span className="mono">{selectedPatient.phone}</span>
                    </a>
                  ) : (
                    <span className="badge badge-urgent">
                      <AlertTriangle size={12} /> No Phone Number
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => setSelectedMRN(null)}
                style={{
                  padding: 6,
                  borderRadius: 6,
                  color: 'var(--text-muted)',
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-medium)'
                }}
              >
                <X size={18} />
              </button>
            </div>

            {/* Drawer Body */}
            <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Call Disposition & Front Desk Notes */}
              <div
                style={{
                  background: 'var(--bg-canvas)',
                  border: '1px solid var(--border-medium)',
                  borderRadius: 8,
                  padding: 16
                }}
              >
                <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--text-primary)', display: 'block', marginBottom: 8 }}>
                  Front Desk Call Logging
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 10, marginBottom: 10 }}>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Call Status
                    </label>
                    <select
                      value={callRecords[selectedPatient.mrn]?.status || 'PENDING'}
                      onChange={(e) => updateDisposition(selectedPatient.mrn, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 6,
                        border: '1px solid var(--border-medium)',
                        fontSize: '0.8rem',
                        fontWeight: 600
                      }}
                    >
                      <option value="PENDING">⏳ To Call</option>
                      <option value="BOOKED">✅ Booked / Rescheduled</option>
                      <option value="VOICEMAIL">📩 Voicemail / Left Msg</option>
                      <option value="CALLBACK">🔄 Callback Requested</option>
                      <option value="WRONG_NUMBER">❌ Wrong / Inactive</option>
                    </select>
                  </div>
                  <div>
                    <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Front Desk Notes
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. Spoke to son, confirmed appointment for next Tuesday"
                      value={callRecords[selectedPatient.mrn]?.notes || ''}
                      onChange={(e) => updateCallNotes(selectedPatient.mrn, e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border-medium)',
                        fontSize: '0.8rem'
                      }}
                    />
                  </div>
                </div>
              </div>

              {/* Warning & Review Flags */}
              {selectedPatient.warning_flags && selectedPatient.warning_flags.length > 0 && (
                <div>
                  <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
                    Clinical Safety & Administrative Flags
                  </span>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selectedPatient.warning_flags.map((flag, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: '#fffbeb',
                          border: '1px solid #fde68a',
                          borderRadius: 6,
                          padding: '8px 12px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: '0.78rem',
                          color: '#92400e'
                        }}
                      >
                        <AlertTriangle size={15} style={{ flexShrink: 0 }} />
                        <span>{flag}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Trigger Explanation */}
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
                  Why This Patient Is On The Call List
                </span>
                <div
                  style={{
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-light)',
                    borderRadius: 8,
                    padding: 14
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <span className="badge badge-urgent">
                      {selectedPatient.reason_tokens?.[0] || 'Follow-Up Overdue'}
                    </span>
                    <span style={{ fontSize: '0.82rem', fontWeight: 700, color: 'var(--text-primary)' }}>
                      {selectedPatient.days_overdue > 0
                        ? `${selectedPatient.days_overdue} days overdue`
                        : `${selectedPatient.days_until} days remaining`}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    {selectedPatient.reason_summary}
                  </p>
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--border-light)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    <strong>Clinical Evidence:</strong> {(selectedPatient.clinical_evidence || []).join('; ')}
                  </div>
                </div>
              </div>

              {/* Latest OPD Visit Note */}
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
                  Most Recent Doctor Note ({selectedPatient.latest_visit?.visit_date})
                </span>
                <div
                  style={{
                    background: 'var(--bg-subtle)',
                    border: '1px solid var(--border-light)',
                    borderRadius: 8,
                    padding: 14
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <span style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)' }}>
                      {selectedPatient.latest_visit?.doctor}
                    </span>
                    <span className="badge badge-outline" style={{ fontSize: '0.7rem' }}>
                      {selectedPatient.latest_visit?.department}
                    </span>
                  </div>
                  <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', fontStyle: 'italic', background: '#fff', padding: '8px 12px', borderRadius: 6, border: '1px solid var(--border-light)' }}>
                    "{selectedPatient.latest_visit?.notes || 'No note recorded'}"
                  </p>
                </div>
              </div>

              {/* Prescriptions on File */}
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
                  Prescribed Medications ({selectedPatient.history?.all_prescriptions?.length || 0})
                </span>
                {selectedPatient.history?.all_prescriptions && selectedPatient.history.all_prescriptions.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {selectedPatient.history.all_prescriptions.map((rx, idx) => (
                      <div
                        key={idx}
                        style={{
                          background: 'var(--bg-canvas)',
                          border: '1px solid var(--border-light)',
                          borderRadius: 6,
                          padding: '6px 12px',
                          fontSize: '0.8rem',
                          color: 'var(--text-primary)',
                          display: 'flex',
                          justifyContent: 'space-between'
                        }}
                      >
                        <span style={{ fontWeight: 600 }}>{rx}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>None on record</span>
                )}
              </div>

              {/* Lab History */}
              <div>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'block', marginBottom: 6 }}>
                  Recent Laboratory Reports ({selectedPatient.history?.labs?.length || 0})
                </span>
                {selectedPatient.history?.labs && selectedPatient.history.labs.length > 0 ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {selectedPatient.history.labs.map((lb, idx) => (
                      <div
                        key={idx}
                        className="mono"
                        style={{
                          background: 'var(--bg-canvas)',
                          border: '1px solid var(--border-light)',
                          borderRadius: 6,
                          padding: '6px 12px',
                          fontSize: '0.75rem',
                          color: 'var(--text-primary)'
                        }}
                      >
                        {lb}
                      </div>
                    ))}
                  </div>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-dim)' }}>None on record</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border-light)',
          background: 'var(--bg-surface)',
          padding: '12px 24px',
          textAlign: 'center',
          fontSize: '0.75rem',
          color: 'var(--text-dim)'
        }}
      >
        St. Vincent Hospital Diabetic Recall Operations • Powered by mera.health
      </footer>
    </div>
  );
}

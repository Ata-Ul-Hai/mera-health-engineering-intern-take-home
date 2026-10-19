import React, { useState, useMemo } from 'react';
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
  ChevronDown,
  ChevronUp,
  FileText,
  User,
  HeartPulse,
  Filter,
  Check,
  Building2,
  Stethoscope,
  Info
} from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState('OVERDUE'); // 'OVERDUE' | 'DUE_SOON' | 'CLINICAL_REVIEW' | 'EXCLUDED'
  const [searchTerm, setSearchTerm] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('ALL'); // 'ALL' | 'HIGH' | 'MEDIUM'
  const [departmentFilter, setDepartmentFilter] = useState('ALL');
  const [expandedMRN, setExpandedMRN] = useState(null);
  const [calledPatients, setCalledPatients] = useState(() => {
    try {
      const saved = localStorage.getItem('mera_called_patients');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const toggleCalled = (mrn) => {
    setCalledPatients((prev) => {
      const next = { ...prev, [mrn]: !prev[mrn] };
      try {
        localStorage.setItem('mera_called_patients', JSON.stringify(next));
      } catch (e) {
        console.error(e);
      }
      return next;
    });
  };

  const toggleExpand = (mrn) => {
    setExpandedMRN((prev) => (prev === mrn ? null : mrn));
  };

  // Distinct lists
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

  // Departments available in data
  const departments = useMemo(() => {
    const set = new Set();
    dataset.patients.forEach((p) => {
      if (p.latest_visit && p.latest_visit.department) {
        set.add(p.latest_visit.department);
      }
    });
    return Array.from(set).sort();
  }, []);

  // Filter active tab's list
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

      return true;
    });
  }, [activeTab, searchTerm, priorityFilter, departmentFilter, overdueList, dueSoonList, reviewList, excludedList]);

  // Export CSV handler
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
      'Priority',
      activeTab === 'DUE_SOON' ? 'Days Remaining' : 'Days Overdue',
      'Target Date',
      'Reason Tokens',
      'Clinical Evidence',
      'Safety & Review Flags',
      'Last Visit Date',
      'Last Department',
      'Last Doctor'
    ];

    const rows = currentList.map((p) => [
      `"${p.mrn}"`,
      `"${p.name}"`,
      `"${p.phone || 'NO_PHONE'}"`,
      `"${p.priority}"`,
      activeTab === 'DUE_SOON' ? p.days_until : p.days_overdue,
      `"${p.target_date}"`,
      `"${p.reason_summary}"`,
      `"${(p.clinical_evidence || []).join('; ')}"`,
      `"${(p.warning_flags || []).join('; ')}"`,
      `"${p.latest_visit ? p.latest_visit.visit_date : ''}"`,
      `"${p.latest_visit ? p.latest_visit.department : ''}"`,
      `"${p.latest_visit ? p.latest_visit.doctor : ''}"`
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

  const highPriorityCount = overdueList.filter((p) => p.priority === 'HIGH').length;

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Navigation */}
      <header
        style={{
          borderBottom: '1px solid var(--border)',
          background: 'rgba(17, 24, 39, 0.8)',
          backdropFilter: 'blur(12px)',
          position: 'sticky',
          top: 0,
          zIndex: 50,
          padding: '16px 24px'
        }}
      >
        <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
              }}
            >
              <HeartPulse size={22} color="#fff" />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h1 style={{ fontSize: '1.25rem', fontWeight: 800, letterSpacing: '-0.02em', color: '#fff' }}>
                  mera.health
                </h1>
                <span className="badge badge-dim">Front Desk Portal</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Diabetic Patient Follow-Up & Call Management System
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: 'var(--bg-card)',
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid var(--border)'
              }}
            >
              <Calendar size={14} color="#9ca3af" />
              <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>Reference Date:</span>
              <span className="mono" style={{ fontSize: '0.85rem', fontWeight: 600, color: '#60a5fa' }}>
                {dataset.reference_date}
              </span>
            </div>

            <button
              onClick={handleExportCSV}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: activeTab === 'DUE_SOON' ? '#059669' : '#2563eb',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: 8,
                fontWeight: 600,
                fontSize: '0.85rem',
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                transition: 'all 0.15s'
              }}
            >
              <Download size={15} />
              {activeTab === 'OVERDUE'
                ? 'Export Overdue CSV'
                : activeTab === 'DUE_SOON'
                ? 'Export Due Soon CSV'
                : 'Export Tab CSV'}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main style={{ maxWidth: 1400, margin: '0 auto', width: '100%', padding: '24px 20px', flex: 1 }}>
        {/* KPI Summary Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: 16,
            marginBottom: 24
          }}
        >
          {/* Overdue Card */}
          <div
            onClick={() => setActiveTab('OVERDUE')}
            style={{
              background: activeTab === 'OVERDUE' ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              border: `2px solid ${activeTab === 'OVERDUE' ? '#ef4444' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                📞 Overdue Call List
              </span>
              <span className="badge badge-red">Active Priority</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: '#f87171' }}>
                {overdueList.length}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#fca5a5' }}>
                ({highPriorityCount} High Risk)
              </span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
              Missed appointment, passed review, or &gt;4 mo gap
            </p>
          </div>

          {/* Due Soon Card */}
          <div
            onClick={() => setActiveTab('DUE_SOON')}
            style={{
              background: activeTab === 'DUE_SOON' ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              border: `2px solid ${activeTab === 'DUE_SOON' ? '#10b981' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                ⏳ Due Soon (Next 14d)
              </span>
              <span className="badge badge-emerald">Preventive</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: '#34d399' }}>
                {dueSoonList.length}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#6ee7b7' }}>Upcoming Reminders</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
              Preventive calls to avoid missed visits
            </p>
          </div>

          {/* Clinical Review Card */}
          <div
            onClick={() => setActiveTab('CLINICAL_REVIEW')}
            style={{
              background: activeTab === 'CLINICAL_REVIEW' ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              border: `2px solid ${activeTab === 'CLINICAL_REVIEW' ? '#a855f7' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                🔍 Clinical Review
              </span>
              <span className="badge badge-purple">Clinician Sign-off</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: '#c084fc' }}>
                {reviewList.length}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#d8b4fe' }}>Lab-Only / Borderline</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
              Confirm diagnosis before calling
            </p>
          </div>

          {/* Safety / Excluded Card */}
          <div
            onClick={() => setActiveTab('EXCLUDED')}
            style={{
              background: activeTab === 'EXCLUDED' ? 'var(--bg-card-hover)' : 'var(--bg-card)',
              border: `2px solid ${activeTab === 'EXCLUDED' ? '#6b7280' : 'var(--border)'}`,
              borderRadius: 12,
              padding: '16px 20px',
              cursor: 'pointer',
              transition: 'all 0.2s'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
                ⛔ Excluded Guardrails
              </span>
              <span className="badge badge-dim">Do Not Call</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 8 }}>
              <span style={{ fontSize: '2rem', fontWeight: 800, color: '#9ca3af' }}>
                {excludedList.length}
              </span>
              <span style={{ fontSize: '0.8rem', color: '#9ca3af' }}>Protected</span>
            </div>
            <p style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: 4 }}>
              Deceased (3), Transferred (3), Non-Diabetic (191)
            </p>
          </div>
        </div>

        {/* Tab Navigation & Filters Toolbar */}
        <div
          style={{
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            borderRadius: 12,
            padding: 16,
            marginBottom: 20
          }}
        >
          {/* Worklist Tabs */}
          <div
            style={{
              display: 'flex',
              gap: 8,
              borderBottom: '1px solid var(--border)',
              paddingBottom: 14,
              marginBottom: 16,
              overflowX: 'auto'
            }}
          >
            <button
              onClick={() => setActiveTab('OVERDUE')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: '0.85rem',
                background: activeTab === 'OVERDUE' ? 'var(--red-bg)' : 'transparent',
                color: activeTab === 'OVERDUE' ? '#f87171' : 'var(--text-muted)',
                border: activeTab === 'OVERDUE' ? '1px solid var(--red-border)' : '1px solid transparent'
              }}
            >
              📞 Overdue Call List
              <span
                style={{
                  background: activeTab === 'OVERDUE' ? '#ef4444' : '#374151',
                  color: '#fff',
                  borderRadius: 12,
                  padding: '2px 8px',
                  fontSize: '0.75rem'
                }}
              >
                {overdueList.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('DUE_SOON')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: '0.85rem',
                background: activeTab === 'DUE_SOON' ? 'var(--emerald-bg)' : 'transparent',
                color: activeTab === 'DUE_SOON' ? '#34d399' : 'var(--text-muted)',
                border: activeTab === 'DUE_SOON' ? '1px solid var(--emerald-border)' : '1px solid transparent'
              }}
            >
              ⏳ Due Soon Reminder List
              <span
                style={{
                  background: activeTab === 'DUE_SOON' ? '#10b981' : '#374151',
                  color: '#fff',
                  borderRadius: 12,
                  padding: '2px 8px',
                  fontSize: '0.75rem'
                }}
              >
                {dueSoonList.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('CLINICAL_REVIEW')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: '0.85rem',
                background: activeTab === 'CLINICAL_REVIEW' ? 'var(--purple-bg)' : 'transparent',
                color: activeTab === 'CLINICAL_REVIEW' ? '#c084fc' : 'var(--text-muted)',
                border: activeTab === 'CLINICAL_REVIEW' ? '1px solid var(--purple-border)' : '1px solid transparent'
              }}
            >
              🔍 Clinical Review Candidates
              <span
                style={{
                  background: activeTab === 'CLINICAL_REVIEW' ? '#a855f7' : '#374151',
                  color: '#fff',
                  borderRadius: 12,
                  padding: '2px 8px',
                  fontSize: '0.75rem'
                }}
              >
                {reviewList.length}
              </span>
            </button>

            <button
              onClick={() => setActiveTab('EXCLUDED')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 16px',
                borderRadius: 8,
                fontWeight: 700,
                fontSize: '0.85rem',
                background: activeTab === 'EXCLUDED' ? 'rgba(107, 114, 128, 0.2)' : 'transparent',
                color: activeTab === 'EXCLUDED' ? '#e5e7eb' : 'var(--text-muted)',
                border: activeTab === 'EXCLUDED' ? '1px solid rgba(107, 114, 128, 0.4)' : '1px solid transparent'
              }}
            >
              ⛔ Excluded / Do Not Call
              <span
                style={{
                  background: activeTab === 'EXCLUDED' ? '#4b5563' : '#374151',
                  color: '#fff',
                  borderRadius: 12,
                  padding: '2px 8px',
                  fontSize: '0.75rem'
                }}
              >
                {excludedList.length}
              </span>
            </button>
          </div>

          {/* Search & Filter Controls */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
            {/* Search Input */}
            <div style={{ position: 'relative', flex: '1 1 280px' }}>
              <Search
                size={16}
                color="#9ca3af"
                style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)' }}
              />
              <input
                type="text"
                placeholder="Search patient name, MRN, phone..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                style={{
                  width: '100%',
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  color: '#fff',
                  padding: '9px 12px 9px 36px',
                  borderRadius: 8,
                  fontSize: '0.85rem',
                  outline: 'none'
                }}
              />
            </div>

            {/* Priority Filter (in Overdue tab) */}
            {activeTab === 'OVERDUE' && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 600 }}>Priority:</span>
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  style={{
                    background: 'var(--bg-primary)',
                    border: '1px solid var(--border)',
                    color: '#fff',
                    padding: '8px 12px',
                    borderRadius: 8,
                    fontSize: '0.85rem'
                  }}
                >
                  <option value="ALL">All Priorities</option>
                  <option value="HIGH">🔴 High Priority ({highPriorityCount})</option>
                  <option value="MEDIUM">🟡 Medium Priority ({overdueList.length - highPriorityCount})</option>
                </select>
              </div>
            )}

            {/* Department Filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)', fontWeight: 600 }}>Department:</span>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                style={{
                  background: 'var(--bg-primary)',
                  border: '1px solid var(--border)',
                  color: '#fff',
                  padding: '8px 12px',
                  borderRadius: 8,
                  fontSize: '0.85rem'
                }}
              >
                <option value="ALL">All Departments</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ marginLeft: 'auto', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
              Showing <strong style={{ color: '#fff' }}>{currentList.length}</strong> patients
            </div>
          </div>
        </div>

        {/* Tab Informational Banner */}
        <div
          style={{
            background:
              activeTab === 'OVERDUE'
                ? 'rgba(239, 68, 68, 0.08)'
                : activeTab === 'DUE_SOON'
                ? 'rgba(16, 185, 129, 0.08)'
                : activeTab === 'CLINICAL_REVIEW'
                ? 'rgba(168, 85, 247, 0.08)'
                : 'rgba(107, 114, 128, 0.08)',
            border: `1px solid ${
              activeTab === 'OVERDUE'
                ? 'var(--red-border)'
                : activeTab === 'DUE_SOON'
                ? 'var(--emerald-border)'
                : activeTab === 'CLINICAL_REVIEW'
                ? 'var(--purple-border)'
                : 'rgba(107, 114, 128, 0.3)'
            }`,
            borderRadius: 10,
            padding: '12px 16px',
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 12
          }}
        >
          <Info size={18} color="currentColor" />
          <div style={{ fontSize: '0.85rem' }}>
            {activeTab === 'OVERDUE' && (
              <span>
                <strong>Action: Call these patients to reschedule.</strong> High priority patients are on insulin or have severe hyperglycemia markers.
              </span>
            )}
            {activeTab === 'DUE_SOON' && (
              <span>
                <strong>Action: Preventive reminder calls.</strong> These patients have follow-ups due in the next 14 days or are approaching 4 months. Calling them now prevents missed appointments.
              </span>
            )}
            {activeTab === 'CLINICAL_REVIEW' && (
              <span>
                <strong>Action: Clinician review required before calling.</strong> These patients have abnormal screening lab results or borderline HbA1c but no prior diabetes diagnosis documented in clinic notes.
              </span>
            )}
            {activeTab === 'EXCLUDED' && (
              <span>
                <strong>Action: Do NOT Call.</strong> Deceased patients and patients who officially transferred care have been audited and excluded to prevent inappropriate calls.
              </span>
            )}
          </div>
        </div>

        {/* Patient Cards / Rows */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {currentList.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '48px 24px',
                background: 'var(--bg-secondary)',
                borderRadius: 12,
                border: '1px solid var(--border)',
                color: 'var(--text-muted)'
              }}
            >
              No patients match the selected filter criteria.
            </div>
          ) : (
            currentList.map((patient) => {
              const isExpanded = expandedMRN === patient.mrn;
              const isCalled = !!calledPatients[patient.mrn];

              return (
                <div
                  key={patient.mrn}
                  style={{
                    background: isCalled ? 'rgba(17, 24, 39, 0.6)' : 'var(--bg-card)',
                    border: `1px solid ${
                      patient.priority === 'HIGH' && activeTab === 'OVERDUE'
                        ? 'var(--red-border)'
                        : 'var(--border)'
                    }`,
                    borderRadius: 10,
                    padding: '16px 20px',
                    transition: 'all 0.15s',
                    opacity: isCalled ? 0.75 : 1
                  }}
                >
                  {/* Top Header Row */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 12
                    }}
                  >
                    {/* Patient Core Identifiers */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      {/* Mark Called Checkbox */}
                      {['OVERDUE', 'DUE_SOON'].includes(activeTab) && (
                        <button
                          onClick={() => toggleCalled(patient.mrn)}
                          title={isCalled ? 'Marked as called' : 'Click to mark as called'}
                          style={{
                            width: 24,
                            height: 24,
                            borderRadius: 6,
                            border: `2px solid ${isCalled ? '#10b981' : 'var(--border)'}`,
                            background: isCalled ? '#10b981' : 'var(--bg-primary)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.15s'
                          }}
                        >
                          {isCalled && <Check size={16} color="#fff" strokeWidth={3} />}
                        </button>
                      )}

                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              fontSize: '1.05rem',
                              fontWeight: 700,
                              color: isCalled ? 'var(--text-muted)' : '#fff',
                              textDecoration: isCalled ? 'line-through' : 'none'
                            }}
                          >
                            {patient.name}
                          </span>
                          <span className="mono badge badge-dim">{patient.mrn}</span>
                          <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                            {patient.sex} • DOB: {patient.dob}
                          </span>
                        </div>

                        {/* Phone Number with Click to Call */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          {patient.phone ? (
                            <a
                              href={`tel:${patient.phone}`}
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 6,
                                color: '#60a5fa',
                                textDecoration: 'none',
                                fontSize: '0.85rem',
                                fontWeight: 600
                              }}
                            >
                              <Phone size={13} />
                              <span className="mono">{patient.phone}</span>
                            </a>
                          ) : (
                            <span className="badge badge-red" style={{ fontSize: '0.75rem' }}>
                              <AlertTriangle size={12} /> No Phone on File
                            </span>
                          )}

                          {isCalled && (
                            <span className="badge badge-emerald">
                              <CheckCircle2 size={12} /> Called
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Status & Priority Badge */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {activeTab === 'OVERDUE' && (
                        patient.priority === 'HIGH' ? (
                          <span className="badge badge-red">🔴 High Priority</span>
                        ) : (
                          <span className="badge badge-amber">🟡 Medium Priority</span>
                        )
                      )}

                      {activeTab === 'DUE_SOON' && (
                        <span className="badge badge-emerald">
                          <Clock size={13} /> In {patient.days_until} days
                        </span>
                      )}

                      {activeTab === 'EXCLUDED' && (
                        <span className="badge badge-dim">
                          <ShieldAlert size={13} /> Excluded
                        </span>
                      )}

                      <button
                        onClick={() => toggleExpand(patient.mrn)}
                        style={{
                          background: 'var(--bg-secondary)',
                          border: '1px solid var(--border)',
                          borderRadius: 6,
                          padding: '6px 10px',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          fontSize: '0.75rem',
                          color: 'var(--text-muted)'
                        }}
                      >
                        {isExpanded ? 'Hide History' : 'View History'}
                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                      </button>
                    </div>
                  </div>

                  {/* Concise Tokenized Reason Box */}
                  <div
                    style={{
                      marginTop: 12,
                      background: 'rgba(0, 0, 0, 0.25)',
                      border: '1px solid rgba(255, 255, 255, 0.06)',
                      borderRadius: 8,
                      padding: '8px 12px',
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 8
                    }}
                  >
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                      Reason:
                    </span>
                    {patient.reason_tokens && patient.reason_tokens.length > 0 ? (
                      patient.reason_tokens.map((token, idx) => (
                        <span
                          key={idx}
                          style={{
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: 4,
                            background:
                              idx === 0
                                ? activeTab === 'DUE_SOON'
                                  ? 'rgba(16, 185, 129, 0.2)'
                                  : 'rgba(239, 68, 68, 0.2)'
                                : 'rgba(255, 255, 255, 0.05)',
                            color:
                              idx === 0
                                ? activeTab === 'DUE_SOON'
                                  ? '#6ee7b7'
                                  : '#fca5a5'
                                : '#e5e7eb'
                          }}
                        >
                          {token}
                        </span>
                      ))
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: 'var(--text-dim)' }}>
                        {patient.exclusion_reason || 'Follow-up evaluated'}
                      </span>
                    )}

                    {patient.latest_visit && (
                      <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-dim)' }}>
                        Last Visit: <strong>{patient.latest_visit.visit_date}</strong> ({patient.latest_visit.department} • {patient.latest_visit.doctor})
                      </span>
                    )}
                  </div>

                  {/* Warning / Audit Badges */}
                  {patient.warning_flags && patient.warning_flags.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {patient.warning_flags.map((flag, idx) => {
                        const isNonDiab = flag.startsWith('Recent Non-Diabetic Visit');
                        const isDup = flag.startsWith('Duplicate Registration');
                        const isShared = flag.startsWith('Shared Family Phone');
                        const isLabOnly = flag.startsWith('Lab Diagnosis Only');
                        const isMissingPhone = flag.startsWith('Missing Phone');

                        let cls = 'badge-amber';
                        if (isNonDiab) cls = 'badge-amber';
                        if (isDup) cls = 'badge-red';
                        if (isShared) cls = 'badge-blue';
                        if (isLabOnly) cls = 'badge-purple';
                        if (isMissingPhone) cls = 'badge-red';

                        return (
                          <span key={idx} className={`badge ${cls}`} style={{ fontSize: '0.75rem' }}>
                            <AlertTriangle size={12} />
                            {flag}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Clinical Evidence Pills */}
                  {patient.clinical_evidence && patient.clinical_evidence.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)', alignSelf: 'center' }}>
                        Evidence:
                      </span>
                      {patient.clinical_evidence.map((ev, idx) => (
                        <span key={idx} className="badge badge-dim" style={{ fontSize: '0.75rem' }}>
                          {ev}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Expandable Clinical History Drawer */}
                  {isExpanded && (
                    <div
                      style={{
                        marginTop: 16,
                        paddingTop: 16,
                        borderTop: '1px solid var(--border)',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                        gap: 16
                      }}
                    >
                      {/* Latest Visit Note */}
                      <div
                        style={{
                          background: 'var(--bg-secondary)',
                          padding: 12,
                          borderRadius: 8,
                          border: '1px solid var(--border)'
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <FileText size={15} color="#60a5fa" />
                          <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fff' }}>
                            Latest Clinical Note
                          </span>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: 'var(--text-main)', fontStyle: 'italic' }}>
                          "{patient.latest_visit ? patient.latest_visit.notes : 'No OPD note recorded'}"
                        </p>
                      </div>

                      {/* Prescriptions */}
                      <div
                        style={{
                          background: 'var(--bg-secondary)',
                          padding: 12,
                          borderRadius: 8,
                          border: '1px solid var(--border)'
                        }}
                      >
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fff', display: 'block', marginBottom: 6 }}>
                          Prescriptions on File ({patient.history?.all_prescriptions?.length || 0})
                        </span>
                        {patient.history?.all_prescriptions && patient.history.all_prescriptions.length > 0 ? (
                          <ul style={{ listStyleType: 'disc', paddingLeft: 18, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {patient.history.all_prescriptions.slice(0, 5).map((rx, idx) => (
                              <li key={idx}>{rx}</li>
                            ))}
                          </ul>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>None recorded</span>
                        )}
                      </div>

                      {/* Lab History */}
                      <div
                        style={{
                          background: 'var(--bg-secondary)',
                          padding: 12,
                          borderRadius: 8,
                          border: '1px solid var(--border)'
                        }}
                      >
                        <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#fff', display: 'block', marginBottom: 6 }}>
                          Recent Lab Tests ({patient.history?.labs?.length || 0})
                        </span>
                        {patient.history?.labs && patient.history.labs.length > 0 ? (
                          <ul style={{ listStyleType: 'disc', paddingLeft: 18, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                            {patient.history.labs.slice(0, 5).map((lb, idx) => (
                              <li key={idx} className="mono">{lb}</li>
                            ))}
                          </ul>
                        ) : (
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-dim)' }}>No labs recorded</span>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </main>

      {/* Footer */}
      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '16px 24px',
          textAlign: 'center',
          fontSize: '0.8rem',
          color: 'var(--text-dim)',
          background: 'var(--bg-secondary)'
        }}
      >
        mera.health Engineering Take-Home Submission • Built for Hospital Front Desk Follow-Up Management
      </footer>
    </div>
  );
}

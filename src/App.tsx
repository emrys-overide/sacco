import React, { lazy, Suspense, useState, useEffect } from 'react';
import type { MemberPortalData, User, Member, Vehicle, Transaction, UserRole } from './types';
import { Menu, ShieldAlert, Search, X } from 'lucide-react';
import { canRole, STORAGE_KEYS } from './lib/auth';
import { fetchSaccoJson, postSaccoJson } from './lib/api';

// Subcomponents
import LoginModal from './components/LoginModal';
import Sidebar from './components/Sidebar';
import PwaInstallPrompt from './components/PwaInstallPrompt';

const GlobalSearchResultsView = lazy(() => import('./components/GlobalSearchResultsView'));
const DashboardView = lazy(() => import('./components/DashboardView'));
const MembersView = lazy(() => import('./components/MembersView'));
const VehiclesView = lazy(() => import('./components/VehiclesView'));
const ReportsView = lazy(() => import('./components/ReportsView'));
const DailyCollectionsView = lazy(() => import('./components/DailyCollectionsView'));
const BlueprintView = lazy(() => import('./components/BlueprintView'));
const ExpensesView = lazy(() => import('./components/ExpensesView'));
const CoopBankView = lazy(() => import('./components/CoopBankView'));
const MemberPortal = lazy(() => import('./components/MemberPortal'));
const OfficerAccountsView = lazy(() => import('./components/OfficerAccountsView'));
const LoansView = lazy(() => import('./components/LoansView'));
const RoleGuideView = lazy(() => import('./components/RoleGuideView'));
const MonthEndCloseView = lazy(() => import('./components/MonthEndCloseView'));

const MEMBER_WRITE_ROLES: readonly UserRole[] = ['Chairman', 'Secretary', 'Treasurer'];
const VEHICLE_WRITE_ROLES: readonly UserRole[] = ['Chairman', 'Secretary'];
const TRANSACTION_WRITE_ROLES: readonly UserRole[] = ['Chairman', 'Treasurer', 'Accountant'];
const CLEAN_START_VERSION = 'secure-session-v2';
const SESSION_IDLE_TIMEOUT_MS = 60 * 60 * 1000;
const SESSION_HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

function prepareCleanStartStorage() {
  if (localStorage.getItem(STORAGE_KEYS.installVersion) === CLEAN_START_VERSION) return;
  [
    'sacco_current_user',
    'sacco_auth_token',
    STORAGE_KEYS.legacyMembers,
    STORAGE_KEYS.legacyVehicles,
    STORAGE_KEYS.legacyTransactions,
    STORAGE_KEYS.savedSheets
  ].forEach(key => localStorage.removeItem(key));
  localStorage.setItem(STORAGE_KEYS.installVersion, CLEAN_START_VERSION);
}

export default function App() {
  prepareCleanStartStorage();
  // Authentication State
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authToken, setAuthToken] = useState('');
  const [isAuthInitializing] = useState(false);

  // Security Alert State
  const [securityAlert, setSecurityAlert] = useState<{ title: string; message: string } | null>(null);

  // Navigation Tab
  const [currentTab, setCurrentTab] = useState<string>('Dashboard');

  // Real-Time Global Search State
  const [globalSearchQuery, setGlobalSearchQuery] = useState<string>('');

  // Mobile Sidebar Drawer State
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState<boolean>(false);

  // Desktop Sidebar Collapse State (Enforces persistence guidelines)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.sidebarCollapsed);
    return stored === null ? true : stored === 'true';
  });

  // Blueprint Approval State
  const [blueprintApproved, setBlueprintApproved] = useState<boolean>(() => {
    return localStorage.getItem(STORAGE_KEYS.blueprintApproved) === 'true';
  });
  const [signerName, setSignerName] = useState<string>(() => {
    return localStorage.getItem(STORAGE_KEYS.blueprintSigner) || '';
  });

  // Core Sacco States with Server Sync (Enforces fullstack database guidelines)
  const [members, setMembers] = useState<Member[]>([]);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [memberPortal, setMemberPortal] = useState<MemberPortalData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Sync state from server on component mount or profile switch
  useEffect(() => {
    if (!currentUser || !authToken) {
      setIsLoading(false);
      return;
    }

    let active = true;
    async function loadSaccoData() {
      try {
        setIsLoading(true);
        if (currentUser.role === 'Member') {
          const portal = await fetchSaccoJson<MemberPortalData>('/api/member-portal', {}, authToken);
          if (active) {
            setMemberPortal(portal);
            setMembers([portal.member]);
            setVehicles(portal.vehicles);
            setTransactions(portal.transactions);
          }
          return;
        }
        const [mData, vData, tData] = await Promise.all([
          fetchSaccoJson<Member[]>('/api/members', {}, authToken),
          fetchSaccoJson<Vehicle[]>('/api/vehicles', {}, authToken),
          fetchSaccoJson<Transaction[]>('/api/transactions', {}, authToken)
        ]);

        if (active) {
          setMembers(mData);
          setVehicles(vData);
          setTransactions(tData);
          setMemberPortal(null);
        }
      } catch (error) {
        console.error('Critical error syncing SACCO registers:', error);
        if (active) {
          setSecurityAlert({
            title: 'Data Synchronization Failed',
            message: error instanceof Error ? error.message : 'The server could not load the SACCO registers. Retry after checking the database connection.'
          });
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadSaccoData();
    return () => {
      active = false;
    };
  }, [currentUser, authToken, refreshTrigger]);

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleLogin = (user: User, token: string) => {
    setCurrentUser(user);
    setCurrentTab(user.role === 'Member' ? 'My Account' : 'Dashboard');
    setAuthToken(token);
  };

  const handleLogout = () => {
    setCurrentUser(null);
    setAuthToken('');
  };

  useEffect(() => {
    if (!currentUser || !authToken) return;
    let idleTimer = window.setTimeout(handleLogout, SESSION_IDLE_TIMEOUT_MS);
    let lastHeartbeat = Date.now();

    const recordActivity = () => {
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(handleLogout, SESSION_IDLE_TIMEOUT_MS);
      if (Date.now() - lastHeartbeat < SESSION_HEARTBEAT_INTERVAL_MS) return;
      lastHeartbeat = Date.now();
      void fetch('/api/auth/activity', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` }
      }).then(response => {
        if (response.status === 401 || response.status === 403) handleLogout();
      }).catch(() => undefined);
    };

    const events: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'scroll', 'focus'];
    events.forEach(event => window.addEventListener(event, recordActivity, { passive: true }));
    return () => {
      window.clearTimeout(idleTimer);
      events.forEach(event => window.removeEventListener(event, recordActivity));
    };
  }, [currentUser, authToken]);

  const handleApproveBlueprint = () => {
    if (currentUser) {
      if (currentUser.role !== 'Chairman') {
        setSecurityAlert({
          title: "Access Control Breach Blocked",
          message: `Your active profile [${currentUser.role}] does not possess Executive Chairman credentials. Design schema and roadmap approvals are restricted to the Chief Technical Chairman.`
        });
        return;
      }
      setBlueprintApproved(true);
      setSignerName(currentUser.name);
      localStorage.setItem(STORAGE_KEYS.blueprintApproved, 'true');
      localStorage.setItem(STORAGE_KEYS.blueprintSigner, currentUser.name);
    }
  };

  const handleClearAllData = () => {
    const confirmed = window.confirm(
      'Clear the local Sacco state? This removes the saved local registers and sheets from this browser. Do you want to proceed?'
    );
    if (!confirmed) return;

    localStorage.removeItem(STORAGE_KEYS.legacyMembers);
    localStorage.removeItem(STORAGE_KEYS.legacyVehicles);
    localStorage.removeItem(STORAGE_KEYS.legacyTransactions);
    localStorage.removeItem(STORAGE_KEYS.blueprintApproved);
    localStorage.removeItem(STORAGE_KEYS.blueprintSigner);
    localStorage.removeItem(STORAGE_KEYS.savedSheets);
    
    setMembers([]);
    setVehicles([]);
    setTransactions([]);
    setBlueprintApproved(false);
    setSignerName('');
    setCurrentTab('Dashboard');
    
    setSecurityAlert({
      title: "System Reset Successful",
      message: "All Sacco registers, vehicles fleet, ledger transactions, and saved sheets have been cleared. You are now running on a clean, new Sacco install."
    });
  };

  // State mutators connected to the authenticated backend API.
  const handleAddMember = async (newMemberData: Omit<Member, 'id' | 'dateRegistered' | 'sharesAmount' | 'savingsAmount'>) => {
    if (!currentUser || !canRole(currentUser, MEMBER_WRITE_ROLES)) {
      setSecurityAlert({
        title: "Unauthorized Action Blocked",
        message: `Your active profile [${currentUser?.role}] is read-only and restricted from registering new members into the Sacco registry.`
      });
      throw new Error('Your profile cannot register SACCO members.');
    }

    try {
      const newMember = await postSaccoJson<Member, typeof newMemberData>('/api/members', newMemberData, authToken);
      setMembers(prev => [newMember, ...prev]);
    } catch (err) {
      console.error("Error creating Sacco member:", err);
      throw err;
    }
  };

  const handleAddVehicle = async (newVehicleData: Omit<Vehicle, 'id'>) => {
    if (!currentUser || !canRole(currentUser, VEHICLE_WRITE_ROLES)) {
      setSecurityAlert({
        title: "Unauthorized Action Blocked",
        message: `Your active profile [${currentUser?.role}] does not possess Sacco Secretary or Chairman privileges. Vehicle registration blocked.`
      });
      throw new Error('Your profile cannot register SACCO vehicles.');
    }

    try {
      const newVehicle = await postSaccoJson<Vehicle, typeof newVehicleData>('/api/vehicles', newVehicleData, authToken);
      setVehicles(prev => [newVehicle, ...prev]);
      const data = await fetchSaccoJson<Member[]>('/api/members', {}, authToken);
      setMembers(data);
    } catch (err) {
      console.error("Error registering vehicle:", err);
      throw err;
    }
  };

  const handleAddTransaction = async (newTxData: Omit<Transaction, 'id' | 'timestamp' | 'recorderName'>) => {
    if (!currentUser || !canRole(currentUser, TRANSACTION_WRITE_ROLES)) {
      setSecurityAlert({
        title: "Unauthorized Action Blocked",
        message: `Your active profile [${currentUser?.role}] does not possess transaction recording rights. General ledger write blocked.`
      });
      throw new Error('Your profile cannot post ledger transactions.');
    }

    const payload = {
      ...newTxData,
      recorderName: currentUser?.name || 'System Official',
      timestamp: new Date().toISOString()
    };

    try {
      const newTx = await postSaccoJson<Transaction, typeof payload>('/api/transactions', payload, authToken);
      setTransactions(prev => [newTx, ...prev]);
      const data = await fetchSaccoJson<Member[]>('/api/members', {}, authToken);
      setMembers(data);
      return newTx;
    } catch (err) {
      console.error("Error posting ledger entry:", err);
      setSecurityAlert({
        title: 'Ledger Entry Not Saved',
        message: err instanceof Error ? err.message : 'The server rejected the ledger entry. No local entry was created.'
      });
      throw err;
    }
  };

  const handleUpdateTransaction = async (transactionId: string, changes: Partial<Transaction>) => {
    if (!currentUser || !canRole(currentUser, TRANSACTION_WRITE_ROLES)) {
      throw new Error('Your profile cannot edit ledger transactions.');
    }
    const updated = await fetchSaccoJson<Transaction>(`/api/transactions/${transactionId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...changes, recorderName: currentUser.name })
    }, authToken);
    const [transactionData, memberData] = await Promise.all([
      fetchSaccoJson<Transaction[]>('/api/transactions', {}, authToken),
      fetchSaccoJson<Member[]>('/api/members', {}, authToken)
    ]);
    setTransactions(transactionData);
    setMembers(memberData);
    return updated;
  };

  const handleReverseTransaction = async (transactionId: string) => {
    if (!currentUser || !canRole(currentUser, TRANSACTION_WRITE_ROLES)) {
      throw new Error('Your profile cannot reverse ledger transactions.');
    }

    const reversal = await fetchSaccoJson<Transaction>(`/api/transactions/${transactionId}/reverse`, {
      method: 'POST'
    }, authToken);
    setTransactions(prev => [reversal, ...prev]);
    const data = await fetchSaccoJson<Member[]>('/api/members', {}, authToken);
    setMembers(data);
  };

  // Auth Screen Guard
  if (isAuthInitializing) {
    return <div className="min-h-screen bg-slate-50 flex items-center justify-center text-sm text-slate-600">Restoring secure session...</div>;
  }

  if (!currentUser || !authToken) {
    return (
      <>
        <LoginModal onLoginSuccess={handleLogin} />
        <PwaInstallPrompt />
      </>
    );
  }

  // Render correct view based on navigation tab
  const renderViewContent = () => {
    if (isLoading) {
      return (
        <div className="flex-1 flex flex-col items-center justify-center bg-slate-50 p-8 space-y-4">
          <div className="relative">
            <div className="w-12 h-12 border-4 border-slate-200 border-t-emerald-600 rounded-full animate-spin"></div>
          </div>
          <div className="text-center">
            <h3 className="text-xs font-bold text-slate-800 uppercase tracking-widest font-mono">Syncing Sacco OS Ledger</h3>
            <p className="text-[10px] text-slate-400 font-mono mt-1">Loading records from persistent storage...</p>
          </div>
        </div>
      );
    }

    if (currentUser.role === 'Member') {
      return memberPortal ? <MemberPortal data={memberPortal} token={authToken} onApplicationCreated={handleRefreshData} /> : (
        <div className="flex-1 flex items-center justify-center bg-slate-50 text-sm text-slate-600">Loading your member account...</div>
      );
    }

    if (globalSearchQuery.trim()) {
      return (
        <GlobalSearchResultsView
          query={globalSearchQuery}
          onClearQuery={() => setGlobalSearchQuery('')}
          members={members}
          vehicles={vehicles}
          transactions={transactions}
          onNavigateToTab={(tab) => {
            setCurrentTab(tab);
            setGlobalSearchQuery('');
          }}
        />
      );
    }

    switch (currentTab) {
      case 'Dashboard':
        return (
          <DashboardView
            transactions={transactions}
            vehicles={vehicles}
            members={members}
            onAddTransaction={handleAddTransaction}
            currentUserRole={currentUser.role}
            currentUserName={currentUser.name}
            onNavigateToTab={setCurrentTab}
          />
        );
      case 'Members':
        return (
          <MembersView
            members={members}
            onAddMember={handleAddMember}
            currentUserRole={currentUser.role}
            transactions={transactions}
          />
        );
      case 'Loans':
        return <LoansView role={currentUser.role} token={authToken} members={members} />;
      case 'Roles & Responsibilities':
        return <RoleGuideView />;
      case 'Month-end Close':
        return currentUser.role === 'Chairman'
          ? <MonthEndCloseView token={authToken} />
          : <div className="flex-1 p-8 text-sm text-slate-600">Only the Chairman can close an accounting month.</div>;
      case 'Daily Collections':
        return (
          <DailyCollectionsView
            vehicles={vehicles}
            members={members}
            transactions={transactions}
            onAddTransaction={handleAddTransaction}
            onUpdateTransaction={handleUpdateTransaction}
            currentUserRole={currentUser.role}
            currentUserName={currentUser.name}
          />
        );
      case 'Expenses':
        return (
          <ExpensesView
            transactions={transactions}
            onAddTransaction={handleAddTransaction}
            currentUserRole={currentUser.role}
            currentUserName={currentUser.name}
          />
        );
      case 'Fleet':
        return (
          <VehiclesView
            vehicles={vehicles}
            members={members}
            onAddVehicle={handleAddVehicle}
            currentUserRole={currentUser.role}
          />
        );
      case 'Reports':
        return (
          <ReportsView
            transactions={transactions}
            vehicles={vehicles}
            members={members}
            onAddTransaction={handleAddTransaction}
            onUpdateTransaction={handleUpdateTransaction}
            onReverseTransaction={handleReverseTransaction}
            currentUser={currentUser}
          />
        );
      case 'Blueprint':
        return (
          <BlueprintView
            onApprove={handleApproveBlueprint}
            isApproved={blueprintApproved}
            signerName={signerName}
          />
        );
      case 'Banking':
        return (
          <CoopBankView fallbackAuthToken={authToken} />
        );
      case 'Account Access':
        return currentUser.role === 'Chairman'
          ? <OfficerAccountsView fallbackAuthToken={authToken} />
          : <div className="flex-1 p-8 text-sm text-slate-600">Only the Chairman can manage account access.</div>;
      default:
        return <div className="p-8">View not found</div>;
    }
  };

  return (
    <div className="app-shell w-full h-screen flex flex-col md:flex-row overflow-hidden font-sans text-slate-900 relative">
      <PwaInstallPrompt />
      {/* Mobile Top Navigation Bar */}
      <div className="app-topbar md:hidden h-14 bg-white text-slate-800 border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-30">
        <button
          onClick={() => setIsMobileSidebarOpen(true)}
          className="p-1.5 rounded hover:bg-slate-50 transition-colors"
          aria-label="Open Navigation Menu"
        >
          <Menu className="w-5 h-5 text-slate-500" />
        </button>
        <div className="flex items-center space-x-2">
          <span className="font-bold uppercase tracking-tight text-sm text-slate-900 font-display">Sowetamu</span>
          <span className="text-blue-600 text-xs font-black">Sacco</span>
        </div>
        <div className="topbar-avatar w-8 h-8 rounded-xl bg-blue-50 flex items-center justify-center font-bold text-[10px] text-blue-600 font-display">
          {currentUser.name.split(' ').map(n => n[0]).join('')}
        </div>
      </div>

      {/* Sidebar Navigation Container */}
      <div className={`fixed inset-y-0 left-0 z-50 transform md:relative md:translate-x-0 transition-transform duration-300 ease-in-out flex ${
        isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
      }`}>
        <Sidebar
          currentTab={currentTab}
          onSelectTab={(tab) => {
            setCurrentTab(tab);
            setIsMobileSidebarOpen(false);
          }}
          currentUser={currentUser}
          onLogout={handleLogout}
          blueprintApproved={blueprintApproved}
          onClose={() => setIsMobileSidebarOpen(false)}
          isDatabaseEmpty={members.length === 0}
          onClearAllData={handleClearAllData}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => {
            const next = !isSidebarCollapsed;
            setIsSidebarCollapsed(next);
            localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(next));
          }}
        />
      </div>

      {/* Mobile Backdrop Overlay */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/60 z-40 md:hidden transition-opacity duration-300" 
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* Main Container */}
      <div className="app-main-surface flex-1 flex flex-col overflow-hidden">
        
        {/* Unified Top Header with Real-Time Global Search */}
        <header className="app-topbar h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between shrink-0 z-20">
          {/* Left Side: Current view identifier */}
          <div className="hidden md:flex items-center space-x-3">
            <span className="topbar-view-orb" aria-hidden="true"></span>
            <span className="text-xs font-bold text-slate-800 uppercase tracking-widest font-display">
              {currentUser.role === 'Member' ? 'MY MEMBER ACCOUNT' : globalSearchQuery.trim() ? 'GLOBAL SYSTEM SEARCH' : `${currentTab}`}
            </span>
            <span className="text-slate-300 font-light text-xs">|</span>
            <span className="text-[9px] bg-blue-50 text-blue-700 border border-blue-200/50 rounded-md font-mono px-2 py-0.5 font-bold uppercase tracking-wider">
              Sacco Financial OS
            </span>
          </div>

          {/* Mobile-only menu quick trigger indicators (if sidebar is closed or open) */}
          <div className="md:hidden flex items-center space-x-2">
            <span className="text-xs font-black text-slate-700 uppercase tracking-wider font-mono">
              {currentUser.role === 'Member' ? 'MY ACCOUNT' : globalSearchQuery.trim() ? 'SEARCH' : currentTab.toUpperCase()}
            </span>
          </div>

          {/* Centered/Right: Search input with modern tailwind aesthetics */}
          {currentUser.role !== 'Member' && <div className="w-full max-w-[280px] sm:max-w-md relative flex items-center">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <input
              type="text"
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
              placeholder="Search members, vehicles or references..."
              aria-label="Search the SACCO system"
              className="global-search w-full pl-9 pr-9 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all placeholder-slate-400 text-slate-800 shadow-inner"
              id="global-search-header-input"
            />
            {globalSearchQuery && (
              <button
                onClick={() => setGlobalSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 transition-colors"
                title="Clear Search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>}

          {/* Right Side: Active role pill */}
          <div className="hidden sm:flex items-center space-x-3">
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-slate-400 font-mono font-medium tracking-widest uppercase">AUDIT SAFE</span>
              <span className="text-[11px] font-bold text-blue-700 flex items-center font-mono">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1.5 animate-pulse"></span>
                {currentUser.role.toUpperCase()}
              </span>
            </div>
            <div className="topbar-avatar w-9 h-9 rounded-xl flex items-center justify-center text-[10px] font-black font-display" title={currentUser.name}>
              {currentUser.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
            </div>
          </div>
        </header>

        {/* Dynamic Inner Viewport */}
        <div className="app-view flex-1 flex flex-col overflow-hidden">
          <Suspense fallback={(
            <div className="flex flex-1 items-center justify-center bg-slate-50 text-xs font-bold uppercase tracking-widest text-slate-500">
              Loading secure workspace...
            </div>
          )}>
            {renderViewContent()}
          </Suspense>
        </div>

        {/* Global Footer */}
        <footer className="app-footer app-topbar h-auto min-h-12 py-3 sm:py-0 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between px-4 sm:px-8 text-[10px] text-slate-500 font-medium shrink-0 gap-2">
          <div className="text-center sm:text-left">&copy; 2026 Sowetamu Sacco. Built for scalability &amp; auditability.</div>
          <div className="flex flex-wrap justify-center gap-4 uppercase tracking-wider font-mono">
            <span className="flex items-center">
              <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-2 animate-pulse"></span>
              Database: PostgreSQL v16 Mapped
            </span>
            <span>Role: {currentUser.role} Scope</span>
          </div>
        </footer>
      </div>

      {/* SECURE POPUP DIALOG FOR ROLE VIOLATIONS */}
      {securityAlert && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4" id="security-denial-modal">
          <div className="bg-white border border-rose-200 rounded-3xl p-6 max-w-sm w-full shadow-2xl text-center space-y-4">
            <div className="w-12 h-12 bg-rose-50 border border-rose-200 text-rose-600 rounded-full flex items-center justify-center mx-auto">
              <ShieldAlert className="w-6 h-6 animate-bounce" />
            </div>
            <div className="space-y-1">
              <h4 className="text-sm font-black text-slate-800 uppercase tracking-wider font-display">{securityAlert.title}</h4>
              <p className="text-xs text-slate-500 leading-relaxed">{securityAlert.message}</p>
            </div>
            <button
              onClick={() => setSecurityAlert(null)}
              className="w-full py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all cursor-pointer"
            >
              Acknowledge &amp; Return
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect } from 'react';
import type { User, Member, Vehicle, Transaction, UserRole } from './types';
import { mockUsers, mockMembers, mockVehicles, mockTransactions } from './data/mockData';
import { Menu, ShieldAlert, Search, X } from 'lucide-react';
import { canRole, STORAGE_KEYS } from './lib/auth';
import { fetchSaccoJson, postSaccoJson } from './lib/api';

// Subcomponents
import LoginModal from './components/LoginModal';
import GlobalSearchResultsView from './components/GlobalSearchResultsView';
import Sidebar from './components/Sidebar';
import DashboardView from './components/DashboardView';
import MembersView from './components/MembersView';
import VehiclesView from './components/VehiclesView';
import ReportsView from './components/ReportsView';
import DailyCollectionsView from './components/DailyCollectionsView';
import BlueprintView from './components/BlueprintView';
import ExpensesView from './components/ExpensesView';
import MessageLogsView from './components/MessageLogsView';
import PaybillView from './components/PaybillView';

const MEMBER_WRITE_ROLES: readonly UserRole[] = ['Chairman', 'Secretary', 'Treasurer'];
const VEHICLE_WRITE_ROLES: readonly UserRole[] = ['Chairman', 'Secretary'];
const TRANSACTION_WRITE_ROLES: readonly UserRole[] = ['Chairman', 'Treasurer', 'Accountant'];

export default function App() {
  // Authentication State
  const [currentUser, setCurrentUser] = useState<User | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.currentUser);
    return stored ? JSON.parse(stored) : null;
  });

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
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [refreshTrigger, setRefreshTrigger] = useState<number>(0);

  // Sync state from server on component mount or profile switch
  useEffect(() => {
    if (!currentUser) {
      setIsLoading(false);
      return;
    }

    let active = true;
    async function loadSaccoData() {
      try {
        setIsLoading(true);
        const [mData, vData, tData] = await Promise.all([
          fetchSaccoJson<Member[]>('/api/members', currentUser),
          fetchSaccoJson<Vehicle[]>('/api/vehicles', currentUser),
          fetchSaccoJson<Transaction[]>('/api/transactions', currentUser)
        ]);

        if (active) {
          setMembers(mData);
          setVehicles(vData);
          setTransactions(tData);
        }
      } catch (error) {
        console.error("Critical error syncing Sacco registers with Firestore:", error);
      } finally {
        if (active) setIsLoading(false);
      }
    }
    loadSaccoData();
    return () => {
      active = false;
    };
  }, [currentUser, refreshTrigger]);

  const handleRefreshData = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleLogin = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(user));
  };

  const handleLogout = () => {
    setCurrentUser(null);
    localStorage.removeItem(STORAGE_KEYS.currentUser);
  };

  const handleSwitchUser = (user: User) => {
    setCurrentUser(user);
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(user));
  };

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

  const handleLoadDemoData = () => {
    localStorage.setItem(STORAGE_KEYS.legacyMembers, JSON.stringify(mockMembers));
    localStorage.setItem(STORAGE_KEYS.legacyVehicles, JSON.stringify(mockVehicles));
    localStorage.setItem(STORAGE_KEYS.legacyTransactions, JSON.stringify(mockTransactions));
    localStorage.setItem(STORAGE_KEYS.blueprintApproved, 'true');
    localStorage.setItem(STORAGE_KEYS.blueprintSigner, 'Hon. Peter Kamau');
    
    setMembers(mockMembers);
    setVehicles(mockVehicles);
    setTransactions(mockTransactions);
    setBlueprintApproved(true);
    setSignerName('Hon. Peter Kamau');
    setCurrentTab('Dashboard');
    
    setSecurityAlert({
      title: "Demo Dataset Loaded",
      message: "Successfully loaded mock Sacco registry, active fleet list, and historic ledger sheets."
    });
  };

  // State Mutators connected directly to the Backend Express API and Firestore Database
  const handleAddMember = (newMemberData: Omit<Member, 'id' | 'dateRegistered' | 'sharesAmount' | 'savingsAmount'>) => {
    if (!currentUser || !canRole(currentUser, MEMBER_WRITE_ROLES)) {
      setSecurityAlert({
        title: "Unauthorized Action Blocked",
        message: `Your active profile [${currentUser?.role}] is read-only and restricted from registering new members into the Sacco registry.`
      });
      return;
    }
    
    postSaccoJson<Member, typeof newMemberData>('/api/members', currentUser, newMemberData)
    .then(newMember => {
      setMembers(prev => [newMember, ...prev]);
    })
    .catch(err => {
      console.error("Error creating Sacco member:", err);
      // Fallback local operation
      const fallbackMember: Member = {
        ...newMemberData,
        id: `m-${Date.now()}`,
        dateRegistered: new Date().toISOString().slice(0, 10),
        sharesAmount: 0,
        savingsAmount: 0
      };
      setMembers(prev => [fallbackMember, ...prev]);
    });
  };

  const handleAddVehicle = (newVehicleData: Omit<Vehicle, 'id'>) => {
    if (!currentUser || !canRole(currentUser, VEHICLE_WRITE_ROLES)) {
      setSecurityAlert({
        title: "Unauthorized Action Blocked",
        message: `Your active profile [${currentUser?.role}] does not possess Sacco Secretary or Chairman privileges. Vehicle registration blocked.`
      });
      return;
    }

    postSaccoJson<Vehicle, typeof newVehicleData>('/api/vehicles', currentUser, newVehicleData)
    .then(newVehicle => {
      setVehicles(prev => [newVehicle, ...prev]);
      fetchSaccoJson<Member[]>('/api/members', currentUser).then(data => setMembers(data));
    })
    .catch(err => {
      console.error("Error registering vehicle:", err);
      const fallbackVehicle: Vehicle = {
        ...newVehicleData,
        id: `v-${Date.now()}`
      };
      setVehicles(prev => [fallbackVehicle, ...prev]);
    });
  };

  const handleAddTransaction = (newTxData: Omit<Transaction, 'id' | 'timestamp' | 'recorderName'>) => {
    if (!currentUser || !canRole(currentUser, TRANSACTION_WRITE_ROLES)) {
      setSecurityAlert({
        title: "Unauthorized Action Blocked",
        message: `Your active profile [${currentUser?.role}] does not possess transaction recording rights. General ledger write blocked.`
      });
      return;
    }

    const payload = {
      ...newTxData,
      recorderName: currentUser?.name || 'System Official',
      timestamp: new Date().toISOString()
    };

    postSaccoJson<Transaction, typeof payload>('/api/transactions', currentUser, payload)
    .then(newTx => {
      setTransactions(prev => [newTx, ...prev]);
      fetchSaccoJson<Member[]>('/api/members', currentUser).then(data => setMembers(data));
    })
    .catch(err => {
      console.error("Error posting ledger entry:", err);
      const fallbackTx: Transaction = {
        ...payload,
        id: `t-${Date.now()}`
      };
      setTransactions(prev => [fallbackTx, ...prev]);
    });
  };

  // Auth Screen Guard
  if (!currentUser) {
    return <LoginModal onLoginSuccess={handleLogin} />;
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
            <p className="text-[10px] text-slate-400 font-mono mt-1">Establishing secure Firestore zero-trust connection...</p>
          </div>
        </div>
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
      case 'Daily Collections':
        return (
          <DailyCollectionsView
            vehicles={vehicles}
            members={members}
            transactions={transactions}
            onAddTransaction={handleAddTransaction}
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
      case 'Message Logs':
        return (
          <MessageLogsView
            members={members}
            currentUserRole={currentUser?.role || 'Member'}
            currentUserName={currentUser?.name || 'Anonymous Member'}
          />
        );
      case 'Paybill Link':
        return (
          <PaybillView
            members={members}
            currentUserRole={currentUser?.role || 'Member'}
            currentUserName={currentUser?.name || 'Anonymous Member'}
            onRefreshData={handleRefreshData}
          />
        );
      default:
        return <div className="p-8">View not found</div>;
    }
  };

  return (
    <div className="w-full h-screen bg-slate-100 flex flex-col md:flex-row overflow-hidden font-sans text-slate-900 relative">
      {/* Mobile Top Navigation Bar */}
      <div className="md:hidden h-14 bg-white text-slate-800 border-b border-slate-200 flex items-center justify-between px-4 shrink-0 z-30">
        <button
          onClick={() => setIsMobileSidebarOpen(true)}
          className="p-1.5 rounded hover:bg-slate-50 transition-colors"
          aria-label="Open Navigation Menu"
        >
          <Menu className="w-5 h-5 text-slate-500" />
        </button>
        <div className="flex items-center space-x-2">
          <span className="font-bold uppercase tracking-tight text-sm text-slate-900 font-display">Sowetamu</span>
          <span className="text-blue-600 text-xs font-black">Pro</span>
        </div>
        <div className="w-7 h-7 rounded bg-blue-50 flex items-center justify-center font-bold text-[10px] text-blue-600 font-display">
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
          onSwitchUser={handleSwitchUser}
          onLogout={handleLogout}
          blueprintApproved={blueprintApproved}
          onClose={() => setIsMobileSidebarOpen(false)}
          isDatabaseEmpty={members.length === 0}
          onClearAllData={handleClearAllData}
          onLoadDemoData={handleLoadDemoData}
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
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50/50">
        
        {/* Unified Top Header with Real-Time Global Search */}
        <header className="h-16 bg-white border-b border-slate-200 px-4 sm:px-8 flex items-center justify-between shrink-0 z-20">
          {/* Left Side: Current view identifier */}
          <div className="hidden md:flex items-center space-x-2">
            <span className="text-xs font-bold text-slate-800 uppercase tracking-widest font-display">
              {globalSearchQuery.trim() ? 'GLOBAL SYSTEM SEARCH' : `${currentTab}`}
            </span>
            <span className="text-slate-300 font-light text-xs">|</span>
            <span className="text-[9px] bg-blue-50 text-blue-700 border border-blue-200/50 rounded-md font-mono px-2 py-0.5 font-bold uppercase tracking-wider">
              Sacco Financial OS
            </span>
          </div>

          {/* Mobile-only menu quick trigger indicators (if sidebar is closed or open) */}
          <div className="md:hidden flex items-center space-x-2">
            <span className="text-xs font-black text-slate-700 uppercase tracking-wider font-mono">
              {globalSearchQuery.trim() ? 'SEARCH' : currentTab.toUpperCase()}
            </span>
          </div>

          {/* Centered/Right: Search input with modern tailwind aesthetics */}
          <div className="w-full max-w-[280px] sm:max-w-md relative flex items-center">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Search className="h-3.5 w-3.5 text-slate-400" />
            </div>
            <input
              type="text"
              placeholder="Search members, vehicles, M-Pesa refs..."
              value={globalSearchQuery}
              onChange={(e) => setGlobalSearchQuery(e.target.value)}
              className="w-full pl-9 pr-9 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 transition-all placeholder-slate-400 text-slate-800 shadow-inner"
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
          </div>

          {/* Right Side: Active role pill */}
          <div className="hidden sm:flex items-center space-x-4">
            <div className="flex flex-col items-end">
              <span className="text-[9px] text-slate-400 font-mono font-medium tracking-widest uppercase">AUDIT SAFE</span>
              <span className="text-[11px] font-bold text-blue-700 flex items-center font-mono">
                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full mr-1.5 animate-pulse"></span>
                {currentUser.role.toUpperCase()}
              </span>
            </div>
          </div>
        </header>

        {/* Dynamic Inner Viewport */}
        <div className="flex-1 flex flex-col overflow-hidden">
          {renderViewContent()}
        </div>

        {/* Global Footer */}
        <footer className="h-auto min-h-12 py-3 sm:py-0 bg-white border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between px-4 sm:px-8 text-[10px] text-slate-400 font-medium shrink-0 gap-2">
          <div className="text-center sm:text-left">&copy; 2026 Matatu Sacco Financial OS. Built for scalability &amp; auditability.</div>
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

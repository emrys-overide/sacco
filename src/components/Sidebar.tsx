import React from 'react';
import { motion } from 'motion/react';
import { User } from '../types';
import { 
  LayoutDashboard, 
  Users, 
  Bus, 
  FileSpreadsheet, 
  FileCode, 
  LogOut, 
  ClipboardList, 
  X, 
  Receipt,
  ChevronLeft,
  ChevronRight,
  Database,
  Building2,
  UserRoundPlus,
  Landmark,
  BookOpenCheck,
  CircleHelp,
  CalendarClock,
  Bug,
  KeyRound,
  History,
  Settings,
  Sparkles
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  currentUser: User;
  onLogout: () => void;
  blueprintApproved: boolean;
  onClose?: () => void;
  isDatabaseEmpty: boolean;
  showDeveloperErrors: boolean;
  onClearBrowserCache: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

interface MenuItem {
  name: string;
  icon: React.ReactNode;
  category: 'Operations' | 'Registers' | 'Financials' | 'Administration' | 'Portal';
}

export default function Sidebar({
  currentTab,
  onSelectTab,
  currentUser,
  onLogout,
  blueprintApproved,
  onClose,
  isDatabaseEmpty,
  showDeveloperErrors,
  onClearBrowserCache,
  isCollapsed,
  onToggleCollapse
}: SidebarProps) {
  const [isHovered, setIsHovered] = React.useState(false);
  const displayCollapsed = isCollapsed && !isHovered;

  const getCategorizedMenuItems = (): MenuItem[] => {
    if (currentUser.role === 'Member') {
      return [{ name: 'My Account', icon: <LayoutDashboard className="w-4 h-4" />, category: 'Portal' }];
    }

    const items: MenuItem[] = [
      // Operations
      { name: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" />, category: 'Operations' },
      ...(currentUser.role !== 'Auditor' ? [
        { name: 'Daily Collections', icon: <ClipboardList className="w-4 h-4" />, category: 'Operations' as const },
        { name: 'Historical Archives', icon: <History className="w-4 h-4" />, category: 'Operations' as const },
        { name: 'Expenses', icon: <Receipt className="w-4 h-4" />, category: 'Operations' as const }
      ] : [
        { name: 'Historical Archives', icon: <History className="w-4 h-4" />, category: 'Operations' as const }
      ]),

      // Registers
      { name: 'Members', icon: <Users className="w-4 h-4" />, category: 'Registers' },
      { name: 'Fleet', icon: <Bus className="w-4 h-4" />, category: 'Registers' },
      { name: 'Banking', icon: <Building2 className="w-4 h-4" />, category: 'Registers' },

      // Financials
      { name: 'Loans', icon: <Landmark className="w-4 h-4" />, category: 'Financials' },
      ...(currentUser.role === 'Chairman' ? [
        { name: 'Month-end Close', icon: <CalendarClock className="w-4 h-4" />, category: 'Financials' as const }
      ] : []),
      { name: 'Reports', icon: <FileSpreadsheet className="w-4 h-4" />, category: 'Financials' },

      // Administration
      ...(currentUser.role === 'Chairman' ? [
        { name: 'Account Access', icon: <UserRoundPlus className="w-4 h-4" />, category: 'Administration' as const }
      ] : []),
      ...(currentUser.role === 'Secretary' ? [
        { name: 'Chairman Recovery', icon: <KeyRound className="w-4 h-4" />, category: 'Administration' as const }
      ] : []),
      { name: 'Roles & Responsibilities', icon: <BookOpenCheck className="w-4 h-4" />, category: 'Administration' },
      { name: 'Account Settings', icon: <Settings className="w-4 h-4" />, category: 'Administration' },
      { name: 'Blueprint', icon: <FileCode className="w-4 h-4" />, category: 'Administration' },
      ...(showDeveloperErrors ? [
        { name: 'Developer Errors', icon: <Bug className="w-4 h-4" />, category: 'Administration' as const }
      ] : [])
    ];

    return items;
  };

  const menuItems = getCategorizedMenuItems();
  const categories: Array<'Operations' | 'Registers' | 'Financials' | 'Administration'> = [
    'Operations',
    'Registers',
    'Financials',
    'Administration'
  ];

  return (
    <aside 
      onMouseEnter={() => { if (isCollapsed) setIsHovered(true); }}
      onMouseLeave={() => setIsHovered(false)}
      onTouchStart={() => { if (isCollapsed) setIsHovered(true); }}
      className={`app-sidebar h-full bg-white text-slate-700 flex flex-col border-r border-slate-200 font-sans shrink-0 transition-all duration-300 ease-in-out ${
        displayCollapsed ? 'w-72 md:w-20' : 'w-72'
      }`}
    >
      {/* Brand Header */}
      <div className={`p-4 border-b border-slate-100 flex items-center transition-all duration-300 ${
        displayCollapsed ? 'justify-center py-6 md:px-0' : 'justify-between px-6 py-5'
      }`}>
        {!displayCollapsed ? (
          <div className="flex items-center space-x-2.5">
            <div className="brand-mark w-9 h-9 bg-emerald-700 rounded-xl flex items-center justify-center shadow-sm shadow-emerald-200 text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold font-display uppercase tracking-wider text-slate-900 flex items-center space-x-1">
                <span>Sowetamu</span>
                <span className="text-emerald-700">Sacco</span>
              </h1>
              <p className="text-[9px] text-slate-400 font-mono tracking-wider font-semibold">
                FINANCIAL OS V1.0
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center md:items-center space-y-1.5 md:block hidden" title="Sowetamu Sacco OS">
            <div className="brand-mark w-10 h-10 bg-emerald-700 rounded-xl flex items-center justify-center shadow-sm shadow-emerald-200 text-white">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
        )}

        {/* Mobile-only Header text */}
        <div className="md:hidden block">
          <h1 className="text-sm font-bold font-display uppercase tracking-wider text-slate-900 flex items-center space-x-1">
            <span>Sowetamu</span>
            <span className="text-emerald-700 font-black">Sacco</span>
          </h1>
        </div>
        
        <div className="flex items-center space-x-2">
          {/* Toggle Collapse Button for Desktop */}
          <button
            onClick={onToggleCollapse}
            className="hidden md:flex p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all cursor-pointer border border-slate-100"
            title={isCollapsed ? "Expand Navigation Panel" : "Collapse Navigation Panel"}
          >
            {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronLeft className="w-3.5 h-3.5" />}
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="md:hidden p-1.5 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-colors"
              aria-label="Close menu"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>
      </div>

      {/* Nav Actions inside Scrollable Container */}
      <div className="flex-1 overflow-y-auto space-y-4 py-3 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
        

        {currentUser.role === 'Member' ? (
          <nav className={`p-3 space-y-1 ${displayCollapsed ? 'md:flex md:flex-col md:items-center md:px-2' : ''}`}>
            {menuItems.map(item => {
              const isActive = currentTab === item.name;
              return (
                <motion.button
                  key={item.name}
                  onClick={() => {
                    onSelectTab(item.name);
                    setIsHovered(false);
                  }}
                  className={`sidebar-nav-item ${isActive ? 'is-active bg-emerald-50 text-emerald-800 font-bold border-r-2 border-emerald-600' : 'text-slate-600 hover:bg-slate-50'} w-full flex items-center justify-between p-2 rounded-lg text-left text-xs`}
                >
                  <div className="flex items-center space-x-3">
                    <span className={isActive ? 'text-emerald-700' : 'text-slate-400'}>{item.icon}</span>
                    <span>{item.name}</span>
                  </div>
                </motion.button>
              );
            })}
          </nav>
        ) : (
          <div className="space-y-4 px-3">
            {categories.map(category => {
              const catItems = menuItems.filter(i => i.category === category);
              if (catItems.length === 0) return null;

              return (
                <div key={category} className="space-y-1">
                  {!displayCollapsed && (
                    <p className="px-2 pb-1 text-[9px] font-bold uppercase tracking-wider text-slate-400 font-mono">
                      {category}
                    </p>
                  )}
                  <div className={`space-y-0.5 ${displayCollapsed ? 'md:flex md:flex-col md:items-center' : ''}`}>
                    {catItems.map(item => {
                      const isActive = currentTab === item.name;
                      return (
                        <motion.button
                          key={item.name}
                          onClick={() => {
                            onSelectTab(item.name);
                            setIsHovered(false);
                          }}
                          title={displayCollapsed ? item.name : undefined}
                          whileHover={{ scale: 1.01, x: displayCollapsed ? 0 : 2 }}
                          whileTap={{ scale: 0.99 }}
                          className={`sidebar-nav-item ${
                            isActive
                              ? 'is-active bg-emerald-50 text-emerald-800 font-bold border-r-2 border-emerald-600 shadow-xs'
                              : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                          } w-full flex items-center transition-all duration-150 text-left cursor-pointer rounded-lg ${
                            displayCollapsed ? 'md:justify-center md:p-2.5' : 'justify-between p-2'
                          }`}
                        >
                          <div className="flex items-center space-x-2.5">
                            <span className={`${isActive ? 'text-emerald-700' : 'text-slate-400'} shrink-0`}>
                              {item.icon}
                            </span>
                            {(!displayCollapsed || window.innerWidth < 768) && (
                              <span className="text-xs font-medium">
                                {item.name === 'Blueprint' ? 'Architecture Blueprint' : item.name}
                              </span>
                            )}
                          </div>

                          {(!displayCollapsed || window.innerWidth < 768) && item.name === 'Blueprint' && (
                            <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded font-mono ${
                              blueprintApproved ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-amber-50 text-amber-700 border border-amber-200'
                            }`}>
                              {blueprintApproved ? 'APPROVED' : 'REVIEW'}
                            </span>
                          )}

                          {displayCollapsed && item.name === 'Blueprint' && (
                            <span className={`absolute top-2 right-2 w-2 h-2 rounded-full hidden md:block ${
                              blueprintApproved ? 'bg-green-500' : 'bg-amber-400 animate-pulse'
                            }`} title={blueprintApproved ? 'Blueprint Approved' : 'Review Required'} />
                          )}
                        </motion.button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Database Status Card */}
        {currentUser.role !== 'Member' && (!displayCollapsed ? (
          <div className="sidebar-section-card mx-3 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-widest">
                Sacco Database
              </span>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded font-mono ${
                isDatabaseEmpty 
                  ? 'bg-red-50 text-red-700 border border-red-200' 
                  : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              }`}>
                {isDatabaseEmpty ? 'EMPTY' : 'ACTIVE'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 leading-normal">
              Continuous audit ledger is online and synchronized.
            </p>
            <div className="pt-1">
              <button
                onClick={onClearBrowserCache}
                className="w-full py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                title="Clear cached data from this browser only"
              >
                Clear Browser Cache
              </button>
            </div>
          </div>
        ) : (
          <div className="sidebar-section-card mx-2 p-2 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center space-y-3 hidden md:flex">
            <span 
              className={`p-1.5 rounded-lg border ${
                isDatabaseEmpty 
                  ? 'bg-red-50 border-red-200 text-red-500' 
                  : 'bg-emerald-50 border-emerald-200 text-emerald-600'
              }`}
              title={isDatabaseEmpty ? 'Database Status: Empty Sacco Registry' : 'Database Status: Active Sacco Registry'}
            >
              <Database className="w-4 h-4" />
            </span>
          </div>
        ))}
      </div>

      {/* Profile Selector & User Meta (Fixed Bottom) */}
      <div className={`sidebar-profile p-3 border-t border-slate-100 bg-white flex flex-col transition-all duration-300 ${
        displayCollapsed ? 'md:space-y-4 md:items-center md:justify-center' : 'space-y-2.5'
      }`}>
        <a
          href="/documentation"
          target="_blank"
          rel="noopener noreferrer"
          className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 ${displayCollapsed ? 'md:justify-center' : ''}`}
          title="Documentation and Technical Help"
        >
          <CircleHelp className="h-4 w-4 shrink-0" />
          {(!displayCollapsed || window.innerWidth < 768) && <span>Documentation &amp; Help</span>}
        </a>
        <div className={`flex items-center justify-between pt-2 border-t border-slate-100 w-full ${
          displayCollapsed ? 'md:flex-col md:space-y-3' : 'space-x-3'
        }`}>
          <div className="flex items-center space-x-2.5">
            <div 
              className="sidebar-avatar w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center font-bold text-xs font-display shrink-0 border border-emerald-200"
              title={`${currentUser.name} (${currentUser.role})`}
            >
              {currentUser.name.split(' ').map(n => n[0]).join('')}
            </div>
            {(!displayCollapsed || window.innerWidth < 768) && (
              <div className="truncate">
                <p className="text-xs font-semibold leading-tight text-slate-950 truncate">{currentUser.name}</p>
                <p className="text-[9px] text-slate-400 uppercase font-bold tracking-wider mt-0.5 font-mono">{currentUser.role}</p>
              </div>
            )}
          </div>

          <button
            onClick={onLogout}
            id="sidebar-logout-button"
            className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-50 rounded transition-colors shrink-0 cursor-pointer"
            title="Log Out Security Session"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

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
  ChevronUp, 
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
  CalendarClock
} from 'lucide-react';

interface SidebarProps {
  currentTab: string;
  onSelectTab: (tab: string) => void;
  currentUser: User;
  onLogout: () => void;
  blueprintApproved: boolean;
  onClose?: () => void;
  isDatabaseEmpty: boolean;
  onClearAllData: () => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

export default function Sidebar({
  currentTab,
  onSelectTab,
  currentUser,
  onLogout,
  blueprintApproved,
  onClose,
  isDatabaseEmpty,
  onClearAllData,
  isCollapsed,
  onToggleCollapse
}: SidebarProps) {
  const [isHovered, setIsHovered] = React.useState(false);
  const displayCollapsed = isCollapsed && !isHovered;

  const administratorMenuItems = [
    { name: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4" /> },
    { name: 'Daily Collections', icon: <ClipboardList className="w-4 h-4" /> },
    { name: 'Expenses', icon: <Receipt className="w-4 h-4" /> },
    { name: 'Members', icon: <Users className="w-4 h-4" /> },
    { name: 'Loans', icon: <Landmark className="w-4 h-4" /> },
    { name: 'Fleet', icon: <Bus className="w-4 h-4" /> },
    { name: 'Banking', icon: <Building2 className="w-4 h-4" /> },
    { name: 'Reports', icon: <FileSpreadsheet className="w-4 h-4" /> },
    { name: 'Blueprint', icon: <FileCode className="w-4 h-4" /> }
  ];
  const officerMenus: Record<Exclude<User['role'], 'Member'>, Array<{ name: string; icon: React.ReactNode }>> = {
    Chairman: [...administratorMenuItems, { name: 'Month-end Close', icon: <CalendarClock className="w-4 h-4" /> }, { name: 'Account Access', icon: <UserRoundPlus className="w-4 h-4" /> }],
    Secretary: administratorMenuItems.filter(item => !['Daily Collections', 'Expenses'].includes(item.name)),
    Treasurer: administratorMenuItems,
    Accountant: administratorMenuItems,
    Auditor: administratorMenuItems.filter(item => !['Daily Collections', 'Expenses'].includes(item.name))
  };
  const menuItems = currentUser.role === 'Member'
    ? [{ name: 'My Account', icon: <LayoutDashboard className="w-4 h-4" /> }]
    : [...officerMenus[currentUser.role], { name: 'Roles & Responsibilities', icon: <BookOpenCheck className="w-4 h-4" /> }];

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
            <div className="brand-mark w-9 h-9 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm shadow-blue-200">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <h1 className="text-sm font-bold font-display uppercase tracking-wider text-slate-900 flex items-center space-x-1">
                <span>Sowetamu</span>
                <span className="text-blue-600">Sacco</span>
              </h1>
              <p className="text-[9px] text-slate-400 font-mono tracking-wider font-semibold">
                FINANCIAL OS V1.0
              </p>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center md:items-center space-y-1.5 md:block hidden" title="Sowetamu Sacco OS">
            <div className="brand-mark w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-sm shadow-blue-200">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
          </div>
        )}

        {/* Mobile-only Header text */}
        <div className="md:hidden block">
          <h1 className="text-sm font-bold font-display uppercase tracking-wider text-slate-900 flex items-center space-x-1">
            <span>Sowetamu</span>
            <span className="text-blue-600 font-black">Sacco</span>
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
      <div className="flex-1 overflow-y-auto space-y-5 py-4 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
        <nav className={`p-3 space-y-1 ${displayCollapsed ? 'md:flex md:flex-col md:items-center md:px-2' : ''}`}>
          {!displayCollapsed && currentUser.role !== 'Member' && (
            <p className="px-2 pb-2 text-[8px] font-bold uppercase tracking-[0.22em] text-emerald-200/45 font-mono">
              Operations workspace
            </p>
          )}
          {menuItems.map((item) => {
            const isActive = currentTab === item.name;
            return (
              <motion.button
                key={item.name}
                onClick={() => {
                  onSelectTab(item.name);
                  setIsHovered(false);
                }}
                title={displayCollapsed ? `${item.name} Directory` : undefined}
                whileHover={{ scale: 1.015, x: displayCollapsed ? 0 : 2 }}
                whileTap={{ scale: 0.985 }}
                className={`sidebar-nav-item ${isActive ? 'is-active' : ''} w-full flex items-center transition-all duration-200 text-left cursor-pointer relative ${
                  displayCollapsed 
                    ? `md:justify-center md:p-2.5 rounded-xl ${
                        isActive 
                          ? 'bg-blue-50 text-blue-600 font-semibold shadow-sm' 
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`
                    : `justify-between p-2 rounded-lg ${
                        isActive
                          ? 'bg-blue-50 text-blue-600 font-semibold'
                          : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                      }`
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className={`${isActive ? 'text-blue-600' : 'text-slate-400 hover:text-slate-600'} shrink-0`}>
                    {item.icon}
                  </span>
                  {(!displayCollapsed || window.innerWidth < 768) && (
                    <span className="text-[13px] font-medium">
                      {item.name === 'Blueprint' ? 'Architecture Blueprint' : `${item.name}`}
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
        </nav>

        {/* Local reset controls are an administrator-only convenience. */}
        {currentUser.role !== 'Member' && (!displayCollapsed ? (
          <div className="sidebar-section-card mx-4 p-3 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-mono font-bold text-slate-500 uppercase tracking-widest">
                Sacco Database
              </span>
              <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded font-mono ${
                isDatabaseEmpty 
                  ? 'bg-red-50 text-red-700 border border-red-200' 
                  : 'bg-green-50 text-green-700 border border-green-200'
              }`}>
                {isDatabaseEmpty ? 'EMPTY' : 'ACTIVE'}
              </span>
            </div>
            <p className="text-[10px] text-slate-400 leading-normal">
              New installs start empty. Add members, vehicles, and ledger entries through the app workflow.
            </p>
            <div className="pt-1">
              <button
                onClick={onClearAllData}
                className="w-full py-1 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded text-[9px] font-bold uppercase tracking-wider transition-all cursor-pointer"
                title="Clear local browser state"
              >
                Clear Local State
              </button>
            </div>
          </div>
        ) : (
          <div className="sidebar-section-card mx-2 p-2 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center space-y-3 hidden md:flex">
            <span 
              className={`p-1.5 rounded-lg border ${
                isDatabaseEmpty 
                  ? 'bg-red-50 border-red-200 text-red-500' 
                  : 'bg-green-50 border-green-200 text-green-500'
              }`}
              title={isDatabaseEmpty ? 'Database Status: Empty Sacco Registry' : 'Database Status: Active Sacco Registry'}
            >
              <Database className="w-4 h-4" />
            </span>
            <div className="flex flex-col space-y-1.5 w-full items-center">
              <button
                onClick={onClearAllData}
                className="p-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-100 rounded text-xs transition-all cursor-pointer hover:scale-105 active:scale-95"
                title="Clear Local State"
              >
                CLR
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Profile Selector & User Meta (Fixed Bottom) */}
      <div className={`sidebar-profile p-4 border-t border-slate-100 bg-white flex flex-col transition-all duration-300 ${
        displayCollapsed ? 'md:space-y-4 md:items-center md:justify-center' : 'space-y-3'
      }`}>
        <div className={`flex items-center justify-between pt-2 border-t border-slate-100 w-full ${
          displayCollapsed ? 'md:flex-col md:space-y-3' : 'space-x-3'
        }`}>
          <div className="flex items-center space-x-3">
            <div 
              className="sidebar-avatar w-9 h-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs font-display shrink-0"
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

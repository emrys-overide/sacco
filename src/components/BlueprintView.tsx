import React, { useState } from 'react';
import { blueprintSections, BlueprintSection } from '../data/blueprint';
import { FileCode, Database, Shield, Zap, GitBranch, Play, CheckCircle2, Award } from 'lucide-react';

interface BlueprintViewProps {
  onApprove: () => void;
  isApproved: boolean;
  signerName: string;
}

export default function BlueprintView({ onApprove, isApproved, signerName }: BlueprintViewProps) {
  const [activeSectionId, setActiveSectionId] = useState<string>('architecture');

  const getSectionIcon = (id: string) => {
    switch (id) {
      case 'architecture':
        return <Zap className="w-4 h-4" />;
      case 'database':
        return <Database className="w-4 h-4" />;
      case 'api':
        return <FileCode className="w-4 h-4" />;
      case 'security':
        return <Shield className="w-4 h-4" />;
      case 'scaling':
        return <Play className="w-4 h-4" />;
      case 'roadmap':
        return <GitBranch className="w-4 h-4" />;
      default:
        return <FileCode className="w-4 h-4" />;
    }
  };

  const activeSection = blueprintSections.find(s => s.id === activeSectionId) || blueprintSections[0];

  // A helper function to parse basic markdown lines into beautiful HTML elements
  const renderFormattedContent = (text: string) => {
    const lines = text.split('\n');
    return lines.map((line, idx) => {
      // Headers
      if (line.startsWith('### ')) {
        return <h4 key={idx} className="text-sm font-bold text-slate-800 mt-6 mb-2 font-display">{line.replace('### ', '')}</h4>;
      }
      if (line.startsWith('*   ')) {
        const parts = line.replace('*   ', '').split(':');
        if (parts.length > 1) {
          return (
            <p key={idx} className="text-xs text-slate-600 ml-4 mb-2">
              <strong className="text-slate-800">{parts[0]}:</strong>{parts.slice(1).join(':')}
            </p>
          );
        }
        return <p key={idx} className="text-xs text-slate-600 ml-4 mb-2">&bull; {line.replace('*   ', '')}</p>;
      }
      // Table Header row format detection
      if (line.startsWith('| ') && line.includes('Method') && line.includes('Role')) {
        return null; // Handle table representation customly below
      }
      if (line.startsWith('| :---') || line.startsWith('| ---')) {
        return null; // Skip table separator
      }
      // Table rows
      if (line.startsWith('| ') && line.endsWith(' |')) {
        const cols = line.split('|').map(c => c.trim()).filter(c => c !== '');
        return (
          <div key={idx} className="grid grid-cols-4 gap-4 p-2 bg-slate-50 border-b border-slate-200 text-xs">
            <code className="text-emerald-700 font-bold">{cols[0]}</code>
            <span className="font-semibold text-slate-700">{cols[1]}</span>
            <span className="text-slate-500 font-mono text-[10px]">{cols[2]}</span>
            <span className="text-slate-600">{cols[3]}</span>
          </div>
        );
      }
      // SQL/YAML code blocks
      if (line.startsWith('```')) {
        return null; // We group code blocks below
      }
      // Simple text lines
      if (line.trim() === '') return <div key={idx} className="h-2"></div>;

      return <p key={idx} className="text-xs text-slate-600 leading-relaxed mb-3">{line}</p>;
    });
  };

  // Extract code snippets specifically to render in syntax highlight box
  const extractCodeBlocks = (text: string): string[] => {
    const regex = /```(sql|yaml|bash)?([\s\S]*?)```/g;
    const blocks: string[] = [];
    let match;
    while ((match = regex.exec(text)) !== null) {
      blocks.push(match[2].trim());
    }
    return blocks;
  };

  const codeBlocks = extractCodeBlocks(activeSection.content);

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 font-sans">
      {/* Blueprint Top Banner */}
      <div className="bg-emerald-950 text-white p-6 border-b border-emerald-900 flex flex-col md:flex-row justify-between items-start md:items-center">
        <div>
          <span className="bg-emerald-800 text-emerald-300 text-[9px] font-bold tracking-widest px-2.5 py-1 rounded uppercase">
            Chief Technical Architect Lead Board
          </span>
          <h2 className="text-xl font-bold font-display tracking-tight mt-2 text-white">
            Sowetamu Sacco &mdash; Technical Enterprise Blueprint
          </h2>
          <p className="text-xs text-emerald-400 mt-1">
            System schemas, API models, encryption, scaling roadmap and database indices designed for 10,000+ members.
          </p>
        </div>

        <div className="mt-4 md:mt-0">
          {isApproved ? (
            <div className="bg-emerald-800/40 border border-emerald-400/50 p-3 rounded flex items-center space-x-3">
              <Award className="w-5 h-5 text-emerald-400" />
              <div>
                <p className="text-xs font-bold text-emerald-300">BLU_PRINT_APPROVED</p>
                <p className="text-[10px] text-emerald-400">Signed by: {signerName}</p>
              </div>
            </div>
          ) : (
            <button
              onClick={onApprove}
              id="approve-blueprint-button"
              className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-emerald-950 text-xs font-black tracking-wider uppercase rounded shadow-md transition-all flex items-center space-x-2"
            >
              <CheckCircle2 className="w-4 h-4 text-emerald-950" />
              <span>APPROVE ARCHITECTURE &amp; DEPLOY</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Navigation tabs */}
        <aside className="w-full md:w-72 bg-white border-b md:border-b-0 md:border-r border-slate-200 p-4 space-y-1.5 shrink-0 overflow-y-auto max-h-[160px] md:max-h-none">
          <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest px-3 mb-2">
            Architecture Matrix
          </p>
          {blueprintSections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSectionId(section.id)}
              className={`w-full flex items-center space-x-3 p-3 text-left rounded transition-colors ${
                activeSectionId === section.id
                  ? 'bg-emerald-50 border-l-4 border-emerald-700 text-emerald-900 font-bold'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className={activeSectionId === section.id ? 'text-emerald-700' : 'text-slate-400'}>
                {getSectionIcon(section.id)}
              </span>
              <div className="truncate">
                <p className="text-xs font-semibold leading-tight">{section.title}</p>
                <p className="text-[10px] text-slate-400 truncate mt-0.5">{section.subtitle}</p>
              </div>
            </button>
          ))}

          {/* Quick Notice Card */}
          <div className="mt-8 p-4 bg-amber-50 border border-amber-200 rounded">
            <h5 className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">Note on Database</h5>
            <p className="text-[10px] text-amber-700 mt-1 leading-normal">
              PostgreSQL is mapped via Django ORM. To optimize analytical reporting and avoid slow table scans, composite indices are pre-configured on: <br />
              <code className="bg-amber-100 px-1 py-0.5 rounded text-[9px] font-mono">financial_ledger(member_id, created_at)</code>
            </p>
          </div>
        </aside>

        {/* Content Viewer */}
        <main className="flex-1 p-4 sm:p-8 overflow-y-auto bg-white">
          <div className="max-w-3xl">
            <div className="border-b border-slate-100 pb-4 mb-6">
              <span className="text-[10px] text-slate-400 uppercase tracking-widest font-mono">DOCUMENT SECTION</span>
              <h3 className="text-xl font-bold text-slate-900 font-display mt-1">{activeSection.title}</h3>
              <p className="text-xs text-slate-500 mt-1">{activeSection.subtitle}</p>
            </div>

            {/* Structured Content Area */}
            <div className="space-y-4">
              {renderFormattedContent(activeSection.content)}

              {/* Display associated code block if any */}
              {codeBlocks.length > 0 && (
                <div className="mt-6 space-y-4">
                  <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest font-mono">
                    Schema / Code Declarations
                  </p>
                  {codeBlocks.map((block, bIdx) => (
                    <div key={bIdx} className="bg-slate-900 text-slate-100 p-4 rounded-lg font-mono text-[11px] overflow-x-auto shadow-sm border border-slate-800">
                      <pre>{block}</pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

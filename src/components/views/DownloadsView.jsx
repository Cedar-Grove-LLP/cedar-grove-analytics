"use client";

import { useState, useMemo } from 'react';
import { ChevronLeft } from 'lucide-react';
import { DateRangeIndicator, CalcTooltip } from '../shared';
import { DownloadsTable } from '../tables';
import { TopDownloadsChart } from '../charts';
import { compareBySeniority } from '@/utils/seniority.mjs';

const TRACKED_FOLDERS = [
  'Administrative',
  'Attorney Employment',
  'Engagements',
  'Legal Memos',
  'New Client Onboarding',
];

const formatLastDownload = (ts) => {
  if (!ts) return '—';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts.slice(0, 10);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};

const AttorneyDownloadTile = ({ attorney }) => {
  const folders = TRACKED_FOLDERS;
  const top = attorney.topFile;
  const cells = [
    { label: 'Total', value: attorney.totalDownloads, accent: 'bg-cg-green/10 text-cg-green' },
    { label: 'Unique Files', value: attorney.uniqueFiles, accent: 'bg-blue-50 text-blue-700' },
    { label: 'Last Active', value: formatLastDownload(attorney.lastDownload), accent: 'bg-amber-50 text-amber-700', small: true },
    ...folders.map(f => ({
      label: f,
      value: attorney.folderCounts[f] || 0,
      accent: 'bg-gray-50 text-gray-800',
    })),
    {
      label: 'Top File',
      value: top ? `${top.file} (${top.count})` : '—',
      accent: 'bg-purple-50 text-purple-700',
      small: true,
    },
  ];

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-900 truncate">{attorney.user}</h4>
        <span className="text-xs text-gray-500">{attorney.totalDownloads} downloads</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {cells.map((cell, i) => (
          <div
            key={i}
            className={`rounded-md px-2 py-2 ${cell.accent} flex flex-col justify-center min-h-[60px]`}
            title={typeof cell.value === 'string' ? cell.value : undefined}
          >
            <div className="text-[10px] uppercase tracking-wide opacity-70 truncate">{cell.label}</div>
            <div className={`font-semibold ${cell.small ? 'text-xs truncate' : 'text-lg'}`}>
              {cell.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const DownloadsView = ({
  dateRangeLabel,
  globalAttorneyFilter,
  allAttorneyNames,
  downloadData,
  attorneyDownloadData = [],
}) => {
  const [selectedFolder, setSelectedFolder] = useState(null);
  const [folderSortConfig, setFolderSortConfig] = useState({ key: 'downloads', direction: 'desc' });
  const [fileSortConfig, setFileSortConfig] = useState({ key: 'downloads', direction: 'desc' });
  const [attorneySort, setAttorneySort] = useState('downloads');

  const handleFolderSort = (key) => {
    let direction = 'desc';
    if (key === 'name') direction = 'asc';
    if (folderSortConfig.key === key) {
      direction = folderSortConfig.direction === 'asc' ? 'desc' : 'asc';
    }
    setFolderSortConfig({ key, direction });
  };

  const handleFileSort = (key) => {
    let direction = 'desc';
    if (key === 'file') direction = 'asc';
    if (fileSortConfig.key === key) {
      direction = fileSortConfig.direction === 'asc' ? 'desc' : 'asc';
    }
    setFileSortConfig({ key, direction });
  };

  const sortedFolders = useMemo(() => {
    const folders = [...downloadData];
    folders.sort((a, b) => {
      let aVal, bVal;
      switch (folderSortConfig.key) {
        case 'name':
          aVal = a.folderName.toLowerCase();
          bVal = b.folderName.toLowerCase();
          break;
        case 'downloads':
          aVal = a.downloads;
          bVal = b.downloads;
          break;
        case 'uniqueFiles':
          aVal = a.uniqueFiles;
          bVal = b.uniqueFiles;
          break;
        case 'lastDownload':
          aVal = a.lastDownload || '';
          bVal = b.lastDownload || '';
          break;
        default:
          aVal = a.downloads;
          bVal = b.downloads;
      }
      if (aVal < bVal) return folderSortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return folderSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return folders;
  }, [downloadData, folderSortConfig]);

  const selectedFolderData = useMemo(() => {
    if (!selectedFolder) return null;
    return downloadData.find(f => f.folderName === selectedFolder);
  }, [downloadData, selectedFolder]);

  const sortedFiles = useMemo(() => {
    if (!selectedFolderData) return [];
    const files = [...selectedFolderData.files];
    files.sort((a, b) => {
      let aVal, bVal;
      switch (fileSortConfig.key) {
        case 'file':
          aVal = a.file.toLowerCase();
          bVal = b.file.toLowerCase();
          break;
        case 'downloads':
          aVal = a.downloads;
          bVal = b.downloads;
          break;
        case 'lastDownload':
          aVal = a.lastDownload || '';
          bVal = b.lastDownload || '';
          break;
        default:
          aVal = a.downloads;
          bVal = b.downloads;
      }
      if (aVal < bVal) return fileSortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return fileSortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    return files;
  }, [selectedFolderData, fileSortConfig]);

  const totalFiles = useMemo(() => {
    return downloadData.reduce((sum, f) => sum + f.uniqueFiles, 0);
  }, [downloadData]);

  return (
    <div className="space-y-6">
      <DateRangeIndicator
        dateRangeLabel={dateRangeLabel}
        entryCount={selectedFolder ? selectedFolderData?.files?.length || 0 : totalFiles}
        globalAttorneyFilter={globalAttorneyFilter}
        allAttorneyNames={allAttorneyNames}
      />

      {selectedFolder ? (
        <>
          <button
            onClick={() => setSelectedFolder(null)}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            <ChevronLeft className="w-4 h-4" />
            Back to all folders
          </button>

          <div className="bg-white rounded-lg shadow px-6 py-4">
            <h3 className="text-lg font-semibold text-gray-900">{selectedFolderData?.folderName}</h3>
            <div className="flex gap-6 mt-1 text-sm text-gray-500">
              <span>
                <CalcTooltip calcKey="downloads" variant="underline" position="bottom">
                  {selectedFolderData?.downloads} downloads
                </CalcTooltip>
              </span>
              <span>{selectedFolderData?.uniqueFiles} files</span>
              <span>{selectedFolderData?.uniqueUsers} users</span>
            </div>
          </div>

          <DownloadsTable
            mode="files"
            data={sortedFiles}
            sortConfig={fileSortConfig}
            onSort={handleFileSort}
          />

          <TopDownloadsChart
            data={sortedFiles}
            mode="files"
            title={`Top Documents in ${selectedFolderData?.folderName || selectedFolder}`}
          />
        </>
      ) : (
        <>
          <DownloadsTable
            mode="folders"
            data={sortedFolders}
            sortConfig={folderSortConfig}
            onSort={handleFolderSort}
            onFolderClick={setSelectedFolder}
          />

          <TopDownloadsChart
            data={sortedFolders}
            mode="folders"
            title="Top Folders by Downloads"
          />

          {attorneyDownloadData.length > 0 && (
            <div className="bg-white rounded-lg shadow p-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    <span className="inline-flex items-center gap-1">
                      Per Attorney
                      <CalcTooltip calcKey="downloads" position="bottom" />
                    </span>
                  </h3>
                  <p className="text-xs text-gray-500">Who downloaded what, broken down by folder</p>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <label className="text-gray-600">Sort:</label>
                  <select
                    value={attorneySort}
                    onChange={(e) => setAttorneySort(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-sm focus:outline-none focus:ring-2 focus:ring-cg-green"
                  >
                    <option value="downloads">Total Downloads</option>
                    <option value="files">Unique Files</option>
                    <option value="recent">Most Recent</option>
                    <option value="name">Name</option>
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {[...attorneyDownloadData]
                  .sort((a, b) => {
                    if (attorneySort === 'files') return b.uniqueFiles - a.uniqueFiles;
                    if (attorneySort === 'recent') return (b.lastDownload || '').localeCompare(a.lastDownload || '');
                    if (attorneySort === 'name') return compareBySeniority(a.user, b.user);
                    return b.totalDownloads - a.totalDownloads;
                  })
                  .map(attorney => (
                    <AttorneyDownloadTile key={attorney.user} attorney={attorney} />
                  ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default DownloadsView;

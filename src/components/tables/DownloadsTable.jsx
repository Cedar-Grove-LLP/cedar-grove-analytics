"use client";

import { FolderOpen } from 'lucide-react';
import { CalcTooltip } from '../shared';
import SortableTh from './SortableTh';

const DownloadsTable = ({
  mode,
  data,
  sortConfig,
  onSort,
  onFolderClick,
}) => {
  const formatDate = (isoString) => {
    if (!isoString) return '—';
    const date = new Date(isoString);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  if (mode === 'folders') {
    return (
      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table aria-label="Download folders" className="min-w-full divide-y divide-gray-200 table-fixed">
          <thead className="bg-gray-50">
            <tr>
              <SortableTh
                label="Folder"
                sortKey="name"
                sortConfig={sortConfig}
                onSort={onSort}
                className="w-[40%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              />
              <SortableTh
                label="Downloads"
                sortKey="downloads"
                sortConfig={sortConfig}
                onSort={onSort}
                className="w-[15%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                <CalcTooltip calcKey="downloads" position="bottom" />
              </SortableTh>
              <SortableTh
                label="Files"
                sortKey="uniqueFiles"
                sortConfig={sortConfig}
                onSort={onSort}
                className="w-[15%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              >
                <CalcTooltip calcKey="uniqueFiles" position="bottom" />
              </SortableTh>
              <th scope="col" className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <span className="inline-flex items-center gap-1">
                  Users
                  <CalcTooltip calcKey="uniqueUsers" position="bottom" />
                </span>
              </th>
              <SortableTh
                label="Last Download"
                sortKey="lastDownload"
                sortConfig={sortConfig}
                onSort={onSort}
                className="w-[20%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
              />
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((folder, idx) => (
              <tr
                key={idx}
                onClick={() => onFolderClick(folder.folderName)}
                className="hover:bg-blue-50 transition-colors cursor-pointer group"
                title={`${folder.files.map(f => f.file).join('\n')}`}
              >
                <th scope="row" className="px-6 py-3 text-sm font-normal text-left text-gray-900 truncate">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFolderClick(folder.folderName);
                      }}
                      className="truncate group-hover:text-blue-600 hover:underline text-left"
                      title={folder.folderName}
                    >
                      {folder.folderName}
                    </button>
                  </div>
                </th>
                <td className="px-6 py-3 text-sm text-gray-900 font-medium">
                  {folder.downloads}
                </td>
                <td className="px-6 py-3 text-sm text-gray-900">
                  {folder.uniqueFiles}
                </td>
                <td className="px-6 py-3 text-sm text-gray-900">
                  {folder.uniqueUsers}
                </td>
                <td className="px-6 py-3 text-sm text-gray-500">
                  {formatDate(folder.lastDownload)}
                </td>
              </tr>
            ))}
            {data.length === 0 && (
              <tr>
                <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                  No download data available for this period
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  }

  // File mode
  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table aria-label="Files in folder" className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <SortableTh
              label="Document"
              sortKey="file"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[60%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Downloads"
              sortKey="downloads"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[20%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="downloads" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Last Download"
              sortKey="lastDownload"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[20%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.map((d, idx) => (
            <tr
              key={idx}
              className="hover:bg-blue-50 transition-colors"
            >
              <th scope="row" className="px-6 py-3 text-sm font-normal text-left text-gray-900 truncate" title={d.file}>
                {d.file}
              </th>
              <td className="px-6 py-3 text-sm text-gray-900">
                {d.downloads}
              </td>
              <td className="px-6 py-3 text-sm text-gray-500">
                {formatDate(d.lastDownload)}
              </td>
            </tr>
          ))}
          {data.length === 0 && (
            <tr>
              <td colSpan={3} className="px-6 py-8 text-center text-sm text-gray-500">
                No documents found in this folder
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
};

export default DownloadsTable;

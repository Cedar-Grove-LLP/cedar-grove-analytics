"use client";

import { FolderOpen } from 'lucide-react';
import { CalcTooltip } from '../shared';

const DownloadsTable = ({
  mode,
  data,
  sortConfig,
  onSort,
  onFolderClick,
}) => {
  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

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
      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full divide-y divide-gray-200 table-fixed">
          <thead className="bg-gray-50">
            <tr>
              <th
                onClick={() => onSort('name')}
                className="w-[40%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              >
                Folder {getSortIndicator('name')}
              </th>
              <th
                onClick={() => onSort('downloads')}
                className="w-[15%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              >
                <span className="inline-flex items-center gap-1">
                  Downloads {getSortIndicator('downloads')}
                  <CalcTooltip calcKey="downloads" position="bottom" />
                </span>
              </th>
              <th
                onClick={() => onSort('uniqueFiles')}
                className="w-[15%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              >
                <span className="inline-flex items-center gap-1">
                  Files {getSortIndicator('uniqueFiles')}
                  <CalcTooltip calcKey="uniqueFiles" position="bottom" />
                </span>
              </th>
              <th className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                <span className="inline-flex items-center gap-1">
                  Users
                  <CalcTooltip calcKey="uniqueUsers" position="bottom" />
                </span>
              </th>
              <th
                onClick={() => onSort('lastDownload')}
                className="w-[20%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
              >
                Last Download {getSortIndicator('lastDownload')}
              </th>
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
                <td className="px-6 py-3 text-sm text-gray-900 truncate">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4 text-amber-500 shrink-0" />
                    <span className="truncate group-hover:text-blue-600" title={folder.folderName}>
                      {folder.folderName}
                    </span>
                  </div>
                </td>
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
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <th
              onClick={() => onSort('file')}
              className="w-[60%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Document {getSortIndicator('file')}
            </th>
            <th
              onClick={() => onSort('downloads')}
              className="w-[20%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Downloads {getSortIndicator('downloads')}
                <CalcTooltip calcKey="downloads" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('lastDownload')}
              className="w-[20%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Last Download {getSortIndicator('lastDownload')}
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {data.map((d, idx) => (
            <tr
              key={idx}
              className="hover:bg-blue-50 transition-colors"
            >
              <td className="px-6 py-3 text-sm text-gray-900 truncate" title={d.file}>
                {d.file}
              </td>
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

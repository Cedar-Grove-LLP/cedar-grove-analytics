import { Calendar, Users } from 'lucide-react';

const DateRangeIndicator = ({
  dateRangeLabel,
  globalAttorneyFilter,
  allAttorneyNames,
}) => {
  const isFiltered = globalAttorneyFilter?.length > 0 && 
                     globalAttorneyFilter?.length < allAttorneyNames?.length;

  return (
    <div className="flex items-center gap-4 text-sm">
      <div className="flex items-center gap-2">
        <Calendar className="w-4 h-4 text-cg-green" />
        <span className="text-cg-dark">Showing data for:</span>
        <span className="font-medium text-cg-green-text">{dateRangeLabel}</span>
      </div>
      
      {isFiltered && (
        <div className="flex items-center gap-2 text-cg-dark">
          <Users className="w-4 h-4" />
          <span>
            Filtered to: {globalAttorneyFilter.length === 1 
              ? globalAttorneyFilter[0] 
              : `${globalAttorneyFilter.length} attorneys`}
          </span>
        </div>
      )}
    </div>
  );
};

export default DateRangeIndicator;
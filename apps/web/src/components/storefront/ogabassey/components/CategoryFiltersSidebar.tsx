'use client';
// Migrated from temp-source/components/CategoryFiltersSidebar.tsx
import { Check, ChevronDown, ChevronUp, Search } from 'lucide-react';
import type React from 'react';
import { useState } from 'react';

interface FilterSectionProps {
  title: string;
  options: string[];
  selectedOptions: string[];
  onChange: (option: string) => void;
  isOpenDefault?: boolean;
}

const FilterSection: React.FC<FilterSectionProps> = ({
  title,
  options,
  selectedOptions,
  onChange,
  isOpenDefault = false,
}) => {
  const [isOpen, setIsOpen] = useState(isOpenDefault);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredOptions = options.filter((opt) =>
    opt.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="border-b border-gray-100 py-4 last:border-0">
      <button type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center justify-between w-full text-left mb-2 group"
      >
        <span className="font-bold text-sm text-gray-900 group-hover:text-red-600 transition-colors">
          {title}
        </span>
        {isOpen ? (
          <ChevronUp size={16} className="text-gray-400" />
        ) : (
          <ChevronDown size={16} className="text-gray-400" />
        )}
      </button>

      {isOpen && (
        <div className="animate-in fade-in slide-in-from-top-1 duration-200">
          {/* Search Bar for the Filter - ADDED as per request */}
          <div className="relative mb-3 mt-1">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={`Search ${title}...`}
              aria-label={`Search ${title}`}
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-hidden focus:border-red-500 focus:ring-1 focus:ring-red-100"
            />
            <Search
              size={12}
              className="absolute left-2.5 top-2 text-gray-400"
            />
          </div>

          <div className="space-y-2 max-h-48 overflow-y-auto pr-1 thin-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map((option) => {
                const isSelected = selectedOptions.includes(option);
                return (
                  <label
                    key={option}
                    className="flex items-start gap-2.5 cursor-pointer group/label"
                  >
                    <div
                      className={`relative w-4 h-4 rounded border mt-0.5 flex items-center justify-center transition-colors ${isSelected ? 'bg-red-600 border-red-600' : 'bg-white border-gray-300 group-hover/label:border-red-400'}`}
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={isSelected}
                        onChange={() => onChange(option)}
                      />
                      {isSelected && (
                        <Check
                          size={10}
                          className="text-white"
                          strokeWidth={3}
                        />
                      )}
                    </div>
                    <span
                      className={`text-sm ${isSelected ? 'text-gray-900 font-medium' : 'text-gray-600'}`}
                    >
                      {option}
                    </span>
                  </label>
                );
              })
            ) : (
              <p className="text-xs text-gray-400 italic py-1">
                No matches found
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export interface FilterState {
  brand: string[];
  condition: string[];
  storage: string[];
  ram: string[];
  graphics: string[];
  colors: string[];
  simType: string[];
  displayType: string[];
  displaySize: string[];
  minPrice: number;
  maxPrice: number;
}

interface CategoryFiltersSidebarProps {
  filters: FilterState;
  availableOptions: Record<
    keyof Omit<FilterState, 'minPrice' | 'maxPrice'>,
    string[]
  >;
  onFilterChange: (section: keyof FilterState, value: string | number) => void;
  onClearFilters: () => void;
  className?: string;
}

export const CategoryFiltersSidebar: React.FC<CategoryFiltersSidebarProps> = ({
  filters,
  availableOptions,
  onFilterChange,
  onClearFilters,
  className = '',
}) => {
  return (
    <div
      className={`bg-white rounded-xl shadow-sm border border-gray-100 p-5 ${className}`}
    >
      <div className="flex items-center justify-between mb-4 border-b border-gray-100 pb-4">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Search size={16} className="text-red-600" />
          Filters
        </h3>
        <button type="button"
          onClick={onClearFilters}
          className="text-xs font-bold text-red-600 hover:text-red-700 hover:underline"
        >
          Clear All
        </button>
      </div>

      {/* Price Range Filter */}
      <div className="border-b border-gray-100 pb-6 mb-2">
        <h4 className="font-bold text-sm text-gray-900 mb-3">
          Price Range (₦)
        </h4>
        <div className="flex items-center gap-2 mb-4">
          <div className="relative flex-1">
            <input
              type="number"
              id="sidebar-min-price"
              name="sidebar-min-price"
              aria-label="Minimum Price"
              value={filters.minPrice || ''}
              onChange={(e) =>
                onFilterChange(
                  'minPrice',
                  Number.parseInt(e.target.value, 10) || 0
                )
              }
              placeholder="Min"
              className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-hidden focus:border-red-500"
            />
          </div>
          <span className="text-gray-400 text-xs">-</span>
          <div className="relative flex-1">
            <input
              type="number"
              id="sidebar-max-price"
              name="sidebar-max-price"
              aria-label="Maximum Price"
              value={filters.maxPrice || ''}
              onChange={(e) =>
                onFilterChange(
                  'maxPrice',
                  Number.parseInt(e.target.value, 10) || 0
                )
              }
              placeholder="Max"
              className="w-full px-3 py-2 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:outline-hidden focus:border-red-500"
            />
          </div>
        </div>
      </div>

      {/* Dynamic Filter Sections */}
      <FilterSection
        title="Brand"
        options={availableOptions.brand}
        selectedOptions={filters.brand}
        onChange={(val) => onFilterChange('brand', val)}
        isOpenDefault={true}
      />

      <FilterSection
        title="Condition"
        options={availableOptions.condition}
        selectedOptions={filters.condition}
        onChange={(val) => onFilterChange('condition', val)}
        isOpenDefault={true}
      />

      {availableOptions.storage.length > 0 && (
        <FilterSection
          title="Internal Storage"
          options={availableOptions.storage}
          selectedOptions={filters.storage}
          onChange={(val) => onFilterChange('storage', val)}
        />
      )}

      {availableOptions.ram.length > 0 && (
        <FilterSection
          title="RAM"
          options={availableOptions.ram}
          selectedOptions={filters.ram}
          onChange={(val) => onFilterChange('ram', val)}
        />
      )}

      {availableOptions.graphics.length > 0 && (
        <FilterSection
          title="Graphics Card"
          options={availableOptions.graphics}
          selectedOptions={filters.graphics}
          onChange={(val) => onFilterChange('graphics', val)}
        />
      )}

      {availableOptions.colors.length > 0 && (
        <FilterSection
          title="Color"
          options={availableOptions.colors}
          selectedOptions={filters.colors}
          onChange={(val) => onFilterChange('colors', val)}
        />
      )}

      {availableOptions.simType.length > 0 && (
        <FilterSection
          title="Sim Type"
          options={availableOptions.simType}
          selectedOptions={filters.simType}
          onChange={(val) => onFilterChange('simType', val)}
        />
      )}

      {availableOptions.displayType.length > 0 && (
        <FilterSection
          title="Display Type"
          options={availableOptions.displayType}
          selectedOptions={filters.displayType}
          onChange={(val) => onFilterChange('displayType', val)}
        />
      )}

      {availableOptions.displaySize.length > 0 && (
        <FilterSection
          title="Display Size"
          options={availableOptions.displaySize}
          selectedOptions={filters.displaySize}
          onChange={(val) => onFilterChange('displaySize', val)}
        />
      )}
    </div>
  );
};

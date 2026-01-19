import React from 'react';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
    icon: LucideIcon;
    title: string;
    subtitle?: string;
    gradient?: string;
    children?: React.ReactNode;
    compact?: boolean;
}

/**
 * Consistent page header component used across all pages
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
    icon: Icon,
    title,
    subtitle,
    gradient = 'from-blue-600 to-indigo-600',
    children,
    compact = false
}) => {
    return (
        <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 ${compact ? 'mb-4' : 'mb-6'}`}>
            <div className="flex items-center gap-3">
                <div className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-lg bg-gradient-to-tr ${gradient} flex items-center justify-center shrink-0`}>
                    <Icon className="text-white" size={compact ? 16 : 20} />
                </div>
                <div>
                    <h1 className={`${compact ? 'text-xl' : 'text-2xl'} font-bold text-white leading-tight`}>{title}</h1>
                    {subtitle && <p className="text-zinc-500 text-xs sm:text-sm">{subtitle}</p>}
                </div>
            </div>
            {children && (
                <div className="flex gap-2">
                    {children}
                </div>
            )}
        </div>
    );
};

export default PageHeader;

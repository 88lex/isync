import React from 'react';
import { LucideIcon } from 'lucide-react';

interface PageHeaderProps {
    icon: LucideIcon;
    title: string;
    subtitle?: string;
    gradient?: string;
    children?: React.ReactNode;
}

/**
 * Consistent page header component used across all pages
 */
export const PageHeader: React.FC<PageHeaderProps> = ({
    icon: Icon,
    title,
    subtitle,
    gradient = 'from-blue-600 to-indigo-600',
    children
}) => {
    return (
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
            <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg bg-gradient-to-tr ${gradient} flex items-center justify-center`}>
                    <Icon className="text-white" size={20} />
                </div>
                <div>
                    <h1 className="text-2xl font-bold text-white">{title}</h1>
                    {subtitle && <p className="text-zinc-500 text-sm">{subtitle}</p>}
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

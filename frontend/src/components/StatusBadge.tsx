import React from 'react';
import { CheckCircle, XCircle, Clock, AlertCircle } from 'lucide-react';

export type StatusType = 'success' | 'error' | 'running' | 'warning' | 'stopped' | 'idle';

interface StatusBadgeProps {
    status: StatusType | string;
    label?: string;
    size?: 'sm' | 'md';
}

const statusConfig: Record<string, { 
    icon: React.ReactNode; 
    color: string; 
    bg: string;
    label: string;
}> = {
    success: { 
        icon: <CheckCircle size={14} />, 
        color: 'text-green-400', 
        bg: 'bg-green-500/10',
        label: 'SUCCESS'
    },
    error: { 
        icon: <XCircle size={14} />, 
        color: 'text-red-400', 
        bg: 'bg-red-500/10',
        label: 'ERROR'
    },
    running: { 
        icon: <Clock size={14} className="animate-spin" />, 
        color: 'text-blue-400', 
        bg: 'bg-blue-500/10',
        label: 'RUNNING'
    },
    warning: { 
        icon: <AlertCircle size={14} />, 
        color: 'text-yellow-400', 
        bg: 'bg-yellow-500/10',
        label: 'WARNING'
    },
    stopped: { 
        icon: <AlertCircle size={14} />, 
        color: 'text-yellow-400', 
        bg: 'bg-yellow-500/10',
        label: 'STOPPED'
    },
    idle: { 
        icon: <Clock size={14} />, 
        color: 'text-zinc-400', 
        bg: 'bg-zinc-500/10',
        label: 'IDLE'
    },
};

/**
 * Consistent status badge component for showing operation states
 */
export const StatusBadge: React.FC<StatusBadgeProps> = ({
    status,
    label,
    size = 'sm'
}) => {
    // Normalize status to lowercase for lookup
    const normalizedStatus = status.toLowerCase();
    const config = statusConfig[normalizedStatus] || statusConfig.idle;
    
    const sizeClasses = size === 'sm' 
        ? 'px-2 py-0.5 text-xs' 
        : 'px-3 py-1 text-sm';
    
    return (
        <span className={`inline-flex items-center gap-1 rounded-md font-medium ${config.color} ${config.bg} ${sizeClasses}`}>
            {config.icon}
            {label || config.label}
        </span>
    );
};

// Additional badge variants
interface SimpleBadgeProps {
    children: React.ReactNode;
    variant?: 'default' | 'success' | 'warning' | 'error' | 'info';
}

const variantStyles = {
    default: 'bg-zinc-800 text-zinc-300',
    success: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    warning: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
    error: 'bg-red-500/10 text-red-400 border border-red-500/20',
    info: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
};

export const Badge: React.FC<SimpleBadgeProps> = ({ children, variant = 'default' }) => {
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${variantStyles[variant]}`}>
            {children}
        </span>
    );
};

export default StatusBadge;

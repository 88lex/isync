"""
Centralized SSH Client for ISync.
Provides unified SSH command execution, tmux session management, and connection testing.
"""
import subprocess
import logging
import shlex
from typing import List, Optional, Tuple, Dict, Any

logger = logging.getLogger(__name__)


class SSHClient:
    """
    Centralized SSH client for executing commands on remote servers.
    Handles connection testing, command execution, and tmux session management.
    """
    
    def __init__(
        self,
        host: str,
        user: Optional[str] = None,
        key_path: Optional[str] = None,
        timeout: int = 10
    ):
        """
        Initialize SSH client.
        
        Args:
            host: SSH host (can be hostname, IP, or SSH alias)
            user: SSH username (optional if using alias)
            key_path: Path to SSH private key (optional)
            timeout: Connection timeout in seconds
        """
        self.host = host
        self.user = user
        self.key_path = key_path
        self.timeout = timeout
    
    def _build_base_cmd(self, extra_args: Optional[List[str]] = None) -> List[str]:
        """Build base SSH command with authentication."""
        target = f"{self.user}@{self.host}" if self.user else self.host
        cmd = ["ssh"]
        
        if self.key_path:
            cmd.extend(["-i", self.key_path])
        
        # Add connection timeout
        cmd.extend(["-o", f"ConnectTimeout={self.timeout}"])
        
        # Add any extra SSH options
        if extra_args:
            cmd.extend(extra_args)
        
        cmd.append(target)
        return cmd
    
    def test_connection(self) -> Tuple[bool, str]:
        """
        Test SSH connectivity.
        
        Returns:
            Tuple of (success: bool, message: str)
        """
        cmd = self._build_base_cmd(["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"])
        cmd.extend(["echo", "SSH_SUCCESS"])
        
        try:
            logger.info(f"[SSHClient] Testing connection to {self.host}...")
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=self.timeout + 5
            )
            
            if result.returncode == 0 and "SSH_SUCCESS" in result.stdout:
                return True, "Connection successful"
            else:
                error = result.stderr.strip() or result.stdout.strip() or "Unknown error"
                return False, f"Connection failed: {error}"
                
        except subprocess.TimeoutExpired:
            return False, f"Connection timed out after {self.timeout}s"
        except Exception as e:
            return False, f"Connection error: {str(e)}"
    
    def run_command(
        self,
        command: str,
        capture_output: bool = True,
        timeout: Optional[int] = None
    ) -> Tuple[int, str, str]:
        """
        Execute a command on the remote server.
        
        Args:
            command: Command to execute
            capture_output: Whether to capture stdout/stderr
            timeout: Command timeout (uses connection timeout if not specified)
            
        Returns:
            Tuple of (return_code, stdout, stderr)
        """
        cmd = self._build_base_cmd()
        cmd.append(command)
        
        effective_timeout = timeout or (self.timeout * 3)
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=capture_output,
                text=True,
                timeout=effective_timeout
            )
            return result.returncode, result.stdout, result.stderr
        except subprocess.TimeoutExpired:
            return -1, "", f"Command timed out after {effective_timeout}s"
        except Exception as e:
            return -1, "", str(e)
    
    def list_tmux_sessions(self) -> List[str]:
        """
        List all tmux sessions on the remote server.
        
        Returns:
            List of session names
        """
        returncode, stdout, stderr = self.run_command("tmux list-sessions -F '#{session_name}' 2>/dev/null || true")
        
        if returncode != 0:
            logger.warning(f"[SSHClient] Failed to list tmux sessions: {stderr}")
            return []
        
        sessions = [s.strip() for s in stdout.strip().split('\n') if s.strip()]
        return sessions
    
    def list_isync_sessions(self) -> List[str]:
        """
        List only ISync-related tmux sessions.
        
        Returns:
            List of isync session names
        """
        all_sessions = self.list_tmux_sessions()
        return [s for s in all_sessions if s.startswith("isync_")]
    
    def kill_tmux_session(self, session_name: str) -> Tuple[bool, str]:
        """
        Kill a specific tmux session.
        
        Args:
            session_name: Name of the tmux session to kill
            
        Returns:
            Tuple of (success: bool, message: str)
        """
        returncode, stdout, stderr = self.run_command(f"tmux kill-session -t {shlex.quote(session_name)}")
        
        if returncode == 0:
            logger.info(f"[SSHClient] Killed tmux session: {session_name}")
            return True, f"Session '{session_name}' killed"
        else:
            error = stderr.strip() or "Unknown error"
            logger.warning(f"[SSHClient] Failed to kill session {session_name}: {error}")
            return False, f"Failed to kill session: {error}"
    
    def kill_all_isync_sessions(self) -> Dict[str, bool]:
        """
        Kill all ISync-related tmux sessions.
        
        Returns:
            Dict mapping session names to success status
        """
        sessions = self.list_isync_sessions()
        results = {}
        
        for session in sessions:
            success, _ = self.kill_tmux_session(session)
            results[session] = success
        
        return results
    
    def start_tmux_session(
        self,
        session_name: str,
        command: str,
        keep_open: bool = True
    ) -> List[str]:
        """
        Build command to start a new tmux session with a command.
        
        Args:
            session_name: Name for the tmux session
            command: Command to run inside tmux
            keep_open: Whether to keep session open after command completes
            
        Returns:
            Full command list for subprocess
        """
        cmd = self._build_base_cmd(["-t"])  # -t for pseudo-tty
        
        # Build the remote command
        remote_cmd = command
        if keep_open:
            remote_cmd += "; echo 'Remote process finished. Press Enter to close session...'; read line"
        
        cmd.extend(["tmux", "new-session", "-s", session_name, remote_cmd])
        return cmd


def create_ssh_client_from_config(config: Dict[str, Any]) -> Optional[SSHClient]:
    """
    Create an SSHClient from ISync configuration dict.
    
    Args:
        config: ISync configuration dictionary
        
    Returns:
        SSHClient instance or None if SSH is disabled
    """
    if not config.get('ssh_enabled'):
        return None
    
    return SSHClient(
        host=config.get('ssh_host', ''),
        user=config.get('ssh_user'),
        key_path=config.get('ssh_key_path'),
        timeout=int(config.get('ssh_connect_timeout', 10))
    )

"""
Unit tests for ISyncEngine utility functions.
"""
import pytest
import sys
import os

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class TestSizeParser:
    """Tests for the parse_size method."""
    
    def test_parse_gigabytes(self):
        from isync_engine import ISyncEngine
        
        # Create a minimal engine instance for testing
        engine = ISyncEngine.__new__(ISyncEngine)
        
        assert engine.parse_size("1.5 GB") == 1.5
        assert engine.parse_size("10G") == 10.0
        assert engine.parse_size("0.5 GiB") == 0.5
    
    def test_parse_megabytes(self):
        from isync_engine import ISyncEngine
        engine = ISyncEngine.__new__(ISyncEngine)
        
        assert engine.parse_size("512 MB") == pytest.approx(0.5, rel=0.01)
        assert engine.parse_size("1024M") == pytest.approx(1.0, rel=0.01)
    
    def test_parse_terabytes(self):
        from isync_engine import ISyncEngine
        engine = ISyncEngine.__new__(ISyncEngine)
        
        assert engine.parse_size("1 TB") == 1024.0
        assert engine.parse_size("0.5T") == 512.0
    
    def test_parse_empty_or_invalid(self):
        from isync_engine import ISyncEngine
        engine = ISyncEngine.__new__(ISyncEngine)
        
        assert engine.parse_size("") == 0.0
        assert engine.parse_size(None) == 0.0
        assert engine.parse_size("invalid") == 0.0


class TestRetryDecorator:
    """Tests for the retry utility."""
    
    def test_retry_succeeds_first_try(self):
        from utils.retry import retry_with_backoff
        
        call_count = 0
        
        @retry_with_backoff(max_retries=3, base_delay=0.01)
        def always_succeeds():
            nonlocal call_count
            call_count += 1
            return "success"
        
        result = always_succeeds()
        assert result == "success"
        assert call_count == 1
    
    def test_retry_succeeds_after_failures(self):
        from utils.retry import retry_with_backoff
        
        call_count = 0
        
        @retry_with_backoff(max_retries=3, base_delay=0.01, exceptions=(ValueError,))
        def fails_twice():
            nonlocal call_count
            call_count += 1
            if call_count < 3:
                raise ValueError("Transient error")
            return "success"
        
        result = fails_twice()
        assert result == "success"
        assert call_count == 3
    
    def test_retry_exhausted(self):
        from utils.retry import retry_with_backoff
        
        @retry_with_backoff(max_retries=2, base_delay=0.01, exceptions=(ValueError,))
        def always_fails():
            raise ValueError("Permanent error")
        
        with pytest.raises(ValueError):
            always_fails()


class TestSSHClient:
    """Tests for the SSH client utility."""
    
    def test_build_base_cmd_with_user(self):
        from utils.ssh_client import SSHClient
        
        client = SSHClient(host="example.com", user="admin")
        cmd = client._build_base_cmd()
        
        assert "ssh" in cmd
        assert "admin@example.com" in cmd
    
    def test_build_base_cmd_with_key(self):
        from utils.ssh_client import SSHClient
        
        client = SSHClient(host="example.com", key_path="/path/to/key")
        cmd = client._build_base_cmd()
        
        assert "-i" in cmd
        assert "/path/to/key" in cmd
    
    def test_build_base_cmd_alias_only(self):
        from utils.ssh_client import SSHClient
        
        client = SSHClient(host="my-server-alias")
        cmd = client._build_base_cmd()
        
        assert "my-server-alias" in cmd


class TestConfigStore:
    """Tests for the configuration store."""
    
    def test_hardcoded_defaults(self):
        from backend.store import ConfigStore
        
        store = ConfigStore()
        defaults = store.get_hardcoded_defaults()
        
        assert 'upload_limit' in defaults
        assert 'transfers' in defaults
        assert defaults['upload_limit'] == '700G'
        assert defaults['transfers'] == 8


if __name__ == "__main__":
    pytest.main([__file__, "-v"])

import logging
import random
import string
import time
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from isync_config import DEFAULT_SA_JSON_PATH

class ISyncAuthManager:
    """
    Handles Google Workspace Admin SDK interactions:
    - Authentication via Service Account Impersonation
    - User Creation
    - Group Membership Management
    - User Deletion
    """
    def __init__(self, sa_json_path, admin_email):
        self.sa_json_path = sa_json_path if sa_json_path else DEFAULT_SA_JSON_PATH
        self.admin_email = admin_email
        self.scopes = [
            'https://www.googleapis.com/auth/admin.directory.user',
            'https://www.googleapis.com/auth/admin.directory.group'
        ]
        self.service = self._get_service()

    def _get_service(self):
        """Authenticates and returns the Directory API service."""
        try:
            creds = service_account.Credentials.from_service_account_file(
                self.sa_json_path, scopes=self.scopes
            )
            # Delegate authority to the admin user
            delegated_creds = creds.with_subject(self.admin_email)
            return build('admin', 'directory_v1', credentials=delegated_creds)
        except Exception as e:
            logging.error(f"[ISyncAuth] Auth Error for {self.admin_email}: {e}")
            raise

    def test_api_connection(self):
        """Simple API call to verify credentials work."""
        try:
            domain = self.admin_email.split('@')[1]
            self.service.users().list(domain=domain, maxResults=1).execute()
            return True, "Connection Successful"
        except Exception as e:
            return False, str(e)

    def generate_password(self):
        """Generates a strong random password."""
        chars = string.ascii_letters + string.digits + "!@#$%"
        return ''.join(random.choices(chars, k=16))

    def create_user(self, domain_name):
        """Creates a temporary user with a random ID."""
        rand_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))
        email = f"isync-{rand_id}@{domain_name}"
        
        body = {
            "primaryEmail": email,
            "name": {"givenName": "ISync", "familyName": f"Bot-{rand_id}"},
            "password": self.generate_password()
        }
        
        try:
            logging.info(f"[ISyncAuth] Creating User: {email}")
            self.service.users().insert(body=body).execute()
            time.sleep(5) # Allow propagation
            return email
        except HttpError as e:
            logging.error(f"[ISyncAuth] Failed to create user {email}: {e}")
            raise

    def add_to_group(self, user_email, group_email):
        """Adds the new user to the permission group."""
        body = {"email": user_email, "role": "MEMBER"}
        try:
            logging.info(f"[ISyncAuth] Adding {user_email} to group {group_email}")
            self.service.members().insert(groupKey=group_email, body=body).execute()
        except HttpError as e:
            if e.resp.status == 409:
                logging.warning("[ISyncAuth] User already in group.")
            else:
                logging.error(f"[ISyncAuth] Failed to add to group: {e}")
                raise

    def delete_user(self, user_email):
        """Deletes the temporary user."""
        try:
            logging.info(f"[ISyncAuth] Deleting User: {user_email}")
            self.service.users().delete(userKey=user_email).execute()
        except HttpError as e:
            if e.resp.status == 404:
                pass # Already deleted
            else:
                logging.error(f"[ISyncAuth] Failed to delete user {user_email}: {e}")

    def provision_uploader(self, domain_name, group_email):
        """Wrapper to create user and add to group in one go."""
        email = self.create_user(domain_name)
        self.add_to_group(email, group_email)
        return email

    def user_exists(self, user_email):
        """Checks if a user exists in the directory."""
        try:
            self.service.users().get(userKey=user_email).execute()
            return True
        except HttpError as e:
            if e.resp.status == 404:
                return False
            raise
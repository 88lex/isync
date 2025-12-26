import logging
import random
import csv
import os
import string
import time
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError
from isync_config import DEFAULT_SA_JSON_PATH
try:
    from faker import Faker
    fake = Faker()
except ImportError:
    fake = None

# Fallback lists for when Faker is missing
FB_FN = ["James", "John", "Robert", "Michael", "William", "David", "Richard", "Joseph", "Thomas", "Charles", "Mary", "Patricia", "Jennifer", "Linda", "Elizabeth", "Barbara", "Susan", "Jessica", "Sarah", "Karen"]
FB_LN = ["Smith", "Johnson", "Williams", "Jones", "Brown", "Davis", "Miller", "Wilson", "Moore", "Taylor", "Anderson", "Thomas", "Jackson", "White", "Harris", "Martin", "Thompson", "Garcia", "Martinez", "Robinson"]
FB_ST = ["Main St", "High St", "Maple Ave", "Park Ave", "Oak St", "Washington St", "Lake View Dr", "Sunset Blvd"]
FB_CT = ["New York", "Los Angeles", "Chicago", "Houston", "Phoenix", "Philadelphia", "San Antonio", "San Diego"]
FB_JB = ["Analyst", "Engineer", "Consultant", "Coordinator", "Specialist", "Director", "Manager"]
FB_DP = ["Operations", "Engineering", "Sales", "Marketing", "Support", "Legal", "Finance"]
FB_CO = ["Global Solutions", "Integrated Systems", "Apex Dynamics", "Summit Technologies", "Vanguard Corp", "Matrix Innovations", "Synergy Partners", "Pinnacle Group", "Omega Corp", "Delta Logistics"]

USER_DB_FILE = "user_db.csv"

class ISyncAuthManager:
    """
    Handles Google Workspace Admin SDK interactions:
    - Authentication via Service Account Impersonation
    - User Creation
    - Group Membership Management
    - User Deletion
    """
    def __init__(self, sa_json_path, admin_email, protected_users=None, company_name="Internal Ops"):
        self.sa_json_path = sa_json_path if sa_json_path else DEFAULT_SA_JSON_PATH
        self.admin_email = admin_email
        self.company_name = company_name
        self.protected_users = [u.lower().strip() for u in (protected_users or [])]
        self.scopes = [
            'https://www.googleapis.com/auth/admin.directory.user',
            'https://www.googleapis.com/auth/admin.directory.group',
            'https://www.googleapis.com/auth/admin.directory.group.member',
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

    def _log_user_creation(self, user_data, password):
        """Logs new user details to a CSV file."""
        file_exists = os.path.isfile(USER_DB_FILE)
        try:
            with open(USER_DB_FILE, mode='a', newline='', encoding='utf-8') as f:
                writer = csv.writer(f)
                if not file_exists:
                    writer.writerow(["Timestamp", "Email", "Password", "Google_ID", "ETag", "Is_Admin", "Org_Unit", "Recovery_Email", "Status", "Suspended", "First_Name", "Last_Name", "Recovery_Phone", "Address", "Job_Title", "Department", "External_ID", "Notes"])
                
                # Extract complex fields safely
                name = user_data.get('name', {})
                orgs = user_data.get('organizations', [{}])[0] if user_data.get('organizations') else {}
                addrs = user_data.get('addresses', [{}])[0] if user_data.get('addresses') else {}
                addr_str = f"{addrs.get('streetAddress', '')}, {addrs.get('locality', '')} {addrs.get('postalCode', '')}"
                ext_ids = user_data.get('externalIds', [{}])[0].get('value', '') if user_data.get('externalIds') else ''
                notes = user_data.get('notes', {}).get('value', '')

                writer.writerow([
                    time.strftime("%Y-%m-%d %H:%M:%S"),
                    user_data.get('primaryEmail'),
                    password,
                    user_data.get('id'),
                    user_data.get('etag'),
                    user_data.get('isAdmin'),
                    user_data.get('orgUnitPath'),
                    user_data.get('recoveryEmail'),
                    "Current",
                    "False",
                    name.get('givenName', ''),
                    name.get('familyName', ''),
                    user_data.get('recoveryPhone', ''),
                    addr_str.strip(', '),
                    orgs.get('title', ''),
                    orgs.get('department', ''),
                    ext_ids,
                    notes
                ])
        except Exception as e:
            logging.error(f"[ISyncAuth] Failed to log user creation: {e}")

    def _update_user_status_log(self, email, status=None):
        """Updates the status of a user in the CSV log."""
        if not os.path.isfile(USER_DB_FILE): return
        
        rows = []
        try:
            with open(USER_DB_FILE, mode='r', newline='', encoding='utf-8') as f:
                reader = csv.DictReader(f)
                rows = list(reader)
            
            for row in rows:
                if row['Email'] == email and status:
                    row['Status'] = status
            
            with open(USER_DB_FILE, mode='w', newline='', encoding='utf-8') as f:
                if rows:
                    writer = csv.DictWriter(f, fieldnames=rows[0].keys())
                    writer.writeheader()
                    writer.writerows(rows)
        except Exception as e:
            logging.error(f"[ISyncAuth] Failed to update user log: {e}")

    def test_api_connection(self):
        """Simple API call to verify credentials work."""
        try:
            domain = self.admin_email.split('@')[1]
            self.service.users().list(domain=domain, maxResults=1).execute()
            # Also verify group access
            self.service.groups().list(domain=domain, maxResults=1).execute()
            return True, "Connection Successful (Users & Groups)"
        except Exception as e:
            return False, str(e)

    def generate_password(self):
        """Generates a strong random password."""
        chars = string.ascii_letters + string.digits + "!@#$%"
        return ''.join(random.choices(chars, k=16))

    def prepare_user_body(self, domain_name):
        """Generates the user body dict without creating the user."""
        domain_name = domain_name.strip()
        
        # Determine Company Name (Randomize if default)
        company = self.company_name
        if company == "Internal Ops":
             company = fake.company() if fake else random.choice(FB_CO)

        # 1. Generate Identity Data
        if fake:
            first_name = fake.first_name()
            last_name = fake.last_name()
            job_title = fake.job()
            dept = "Operations"
            street = fake.street_address()
            city = fake.city()
            state = fake.state_abbr()
            zip_code = fake.zipcode()
        else:
            first_name = random.choice(FB_FN)
            last_name = random.choice(FB_LN)
            job_title = random.choice(FB_JB)
            dept = random.choice(FB_DP)
            street = f"{random.randint(100, 999)} {random.choice(FB_ST)}"
            city = random.choice(FB_CT)
            state = "CA"
            zip_code = f"{random.randint(10000, 99999)}"

        # Generate a safe US phone number (10 digits, starting with 2-9)
        # Ensures E.164 compliance when prepended with +1
        phone_digits = f"{random.randint(200, 999)}{random.randint(200, 999)}{random.randint(1000, 9999)}"

        # 2. Construct Email & Password
        rand_id = ''.join(random.choices(string.ascii_lowercase + string.digits, k=4))
        email = f"{first_name.lower()}.{last_name.lower()}.{rand_id}@{domain_name}"
        password = self.generate_password()
        recovery_phone = f"+1{phone_digits}"

        # 3. Build High-Trust Body (Unified)
        body = {
            "primaryEmail": email,
            "name": {"givenName": first_name, "familyName": last_name},
            "password": password,
            "changePasswordAtNextLogin": True,
            "recoveryEmail": self.admin_email,
            "recoveryPhone": recovery_phone,
            "organizations": [{"title": job_title, "department": dept, "name": company, "primary": True}],
            "addresses": [{"type": "work", "streetAddress": street, "locality": city, "region": state, "postalCode": zip_code, "primary": True}],
            "externalIds": [{"type": "organization", "value": f"EMP-{random.randint(10000, 99999)}"}],
            "notes": {"value": "ISync Automated User" if fake else "ISync Automated User (Fallback Profile)"}
        }
        return body

    def create_user(self, domain_name, user_body=None):
        """Creates a temporary user. Uses provided body or generates a new one."""
        if user_body is None:
            user_body = self.prepare_user_body(domain_name)
            
        email = user_body['primaryEmail']
        password = user_body['password']
        
        try:
            logging.info(f"[ISyncAuth] Creating User: {email}")
            user_res = self.service.users().insert(body=user_body).execute()
            self._log_user_creation(user_res, password)
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
        if user_email.lower().strip() in self.protected_users:
            logging.warning(f"[ISyncAuth] BLOCKED DELETE: {user_email} is in Protected Users list.")
            return

        try:
            logging.info(f"[ISyncAuth] Deleting User: {user_email}")
            self.service.users().delete(userKey=user_email).execute()
            self._update_user_status_log(user_email, status="Deleted")
        except HttpError as e:
            if e.resp.status == 404:
                pass # Already deleted
            else:
                logging.error(f"[ISyncAuth] Failed to delete user {user_email}: {e}")

    def provision_uploader(self, domain_name, group_email, user_body=None):
        """Wrapper to create user and add to group in one go."""
        email = self.create_user(domain_name, user_body=user_body)
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

    def list_users(self, domain_name, max_results=500, return_detailed=False):
        """Lists users in the domain."""
        try:
            results = self.service.users().list(domain=domain_name, maxResults=max_results, orderBy='email').execute()
            users = results.get('users', [])
            if return_detailed:
                return [{'email': u['primaryEmail'], 'suspended': u.get('suspended', False), 'suspensionReason': u.get('suspensionReason', '')} for u in users]
            return [u['primaryEmail'] for u in users]
        except HttpError as e:
            logging.error(f"[ISyncAuth] Failed to list users: {e}")
            raise
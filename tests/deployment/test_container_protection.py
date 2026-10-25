"""Protect other projects while allowing an owned NEXUS service to be recreated."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import uuid

ROOT=Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('guard_console',ROOT/'deploy/tencent_advertising.py')
console=importlib.util.module_from_spec(spec);spec.loader.exec_module(console)

class ProtectionContract(unittest.TestCase):
    def test_only_exact_project_and_known_service_are_excluded(self):
        project='nexus-contract-test'
        rows=[('a'*64,'owned',project,'gate'),('b'*64,'nexus-contract-test-web','another-project','web'),('c'*64,'unknown',project,'customer-db'),('d'*64,'nexus-contract-test-api','','')]
        listing='\n'.join('\t'.join(row) for row in rows)+'\n'
        with patch.object(console,'run',return_value=listing):
            self.assertEqual(console.protected_containers(['docker'],project),{'b'*64:'nexus-contract-test-web','c'*64:'unknown','d'*64:'nexus-contract-test-api'})

    def test_malformed_listing_fails_closed(self):
        with patch.object(console,'run',return_value='unreadable'):
            with self.assertRaisesRegex(RuntimeError,'清单'):console.protected_containers(['docker'],'nexus-contract-test')

class ResumeContract(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory(prefix='nexus-resume-contract-')
        self.state=Path(self.temporary.name);self.project='nexus-resume-contract'
        self.config=json.dumps(console.compose_config(self.state/'source',self.project,43153),indent=2)
        console.write_private(self.state/'managed.json',json.dumps({'owner':console.OWNER,'project':self.project,'source':console.SOURCE,'created_at':'retain-original-time'}))
        console.write_private(self.state/'compose.json',self.config)
        console.write_private(self.state/'auth.env','retained-auth-placeholder')
        console.automatic_password(self.state)
        self.original={name:(self.state/name).read_bytes() for name in ('managed.json','compose.json','auth.env','login.json')}
    def tearDown(self):self.temporary.cleanup()
    def invoke(self,*,local=True,protected=None,wait_error=None):
        from contextlib import ExitStack,redirect_stdout
        import io,sys
        args=['console','--state-dir',str(self.state),'--project',self.project,'--port','43153','--auto-password','--resume']+(['--local-only'] if local else [])
        with ExitStack() as stack:
            stack.enter_context(patch.object(sys,'argv',args))
            stack.enter_context(redirect_stdout(io.StringIO()))
            stack.enter_context(patch.object(console,'docker_command',return_value=['docker']))
            stack.enter_context(patch.object(console,'occupied_resources',return_value=True))
            resource=stack.enter_context(patch.object(console,'resources_available',side_effect=AssertionError('Resume must not require build budget')))
            baseline=stack.enter_context(patch.object(console,'protected_containers',side_effect=protected) if protected is not None else patch.object(console,'protected_containers',return_value={}))
            unpack=stack.enter_context(patch.object(console,'unpack_release',return_value=self.state/'source'))
            gate=stack.enter_context(patch.object(console,'wait_gate',side_effect=wait_error))
            acceptance=stack.enter_context(patch.object(console,'verify_rendered_delivery',return_value={'jobId':'a'*32,'media':{'sha256':'b'*64}}))
            stack.enter_context(patch.object(console,'verify_sample_download'))
            stack.enter_context(patch.object(console,'verify_gate'))
            stack.enter_context(patch.object(console,'show_automatic_login'))
            hash_password=stack.enter_context(patch.object(console,'password_hash',side_effect=AssertionError('Do not replace auth hash')))
            def command(argv,**kwargs):
                if argv[-1]=='tunnel' and ('pull' in argv or 'up' in argv):return ''
                if 'logs' in argv:return 'https://nexus-resume-contract.trycloudflare.com'
                raise AssertionError('Unexpected mutation/command: '+repr(argv))
            run=stack.enter_context(patch.object(console,'run',side_effect=command))
            console.main()
            resource.assert_not_called();hash_password.assert_not_called()
            unpack.assert_called_once_with(self.state,None)
            acceptance.assert_called_once()
            return run.call_args_list
    def assert_preserved(self):
        for name,data in self.original.items():self.assertEqual((self.state/name).read_bytes(),data,name)
    def test_local_resume_does_not_build_restart_or_rewrite_credentials(self):
        self.assertEqual(self.invoke(),[])
        self.assert_preserved()
        self.assertEqual((self.state/'protected-containers.json').stat().st_mode&0o777,0o600)
        self.assertFalse((self.state/'url.txt').exists())
    def test_public_resume_mutates_only_the_tunnel(self):
        calls=self.invoke(local=False)
        self.assertEqual(len(calls),3)
        self.assertTrue('pull' in calls[0].args[0] and calls[0].args[0][-1]=='tunnel')
        self.assertTrue('up' in calls[1].args[0] and calls[1].args[0][-1]=='tunnel')
        self.assertEqual((self.state/'url.txt').read_text(),'https://nexus-resume-contract.trycloudflare.com/#advertising\n')
        self.assert_preserved()
    def test_resume_refuses_missing_login_without_generating_a_new_one(self):
        (self.state/'login.json').unlink()
        with self.assertRaises(FileNotFoundError):self.invoke()
        self.assertFalse((self.state/'login.json').exists())
        self.assertEqual((self.state/'auth.env').read_bytes(),self.original['auth.env'])
    def test_stopped_application_is_not_restarted_by_resume(self):
        with self.assertRaisesRegex(RuntimeError,'unavailable'):self.invoke(wait_error=RuntimeError('application unavailable'))
        self.assert_preserved();self.assertFalse((self.state/'url.txt').exists())
    def test_foreign_stop_blocks_publication_and_names_the_container(self):
        with self.assertRaisesRegex(RuntimeError,'other-business'):
            self.invoke(local=False,protected=[{'c'*64:'other-business'},{}])
        self.assertFalse((self.state/'url.txt').exists());self.assert_preserved()
    def test_resume_refuses_edited_config(self):
        console.write_private(self.state/'compose.json','{"edited":true}')
        with self.assertRaisesRegex(RuntimeError,'配置被改动'):self.invoke()
        self.assertEqual((self.state/'compose.json').read_text(),'{"edited":true}')

class RealContainerGuard(unittest.TestCase):
    def test_recreating_owned_service_is_allowed_but_stopping_foreign_service_blocks(self):
        # All manipulated containers are uniquely named disposable test fixtures.
        # Nothing is published, and no existing service is stopped or restarted.
        project='nexus-guard-test-'+uuid.uuid4().hex[:10]
        names=[]
        def docker(*args):return subprocess.check_output(['docker',*args],text=True).strip()
        def start(suffix,owner,service):
            name=project+'-'+suffix
            docker('run','-d','--name',name,'--label','com.docker.compose.project='+owner,'--label','com.docker.compose.service='+service,console.CADDY_IMAGE)
            if name not in names:names.append(name)
            return name
        original=console.running_containers(['docker'])
        try:
            own=start('own',project,'gate')
            foreign=start('foreign','another-business','web')
            unknown=start('unknown',project,'customer-database')
            old=console.running_containers(['docker'])
            protected=console.protected_containers(['docker'],project)
            self.assertIn(foreign,protected.values());self.assertIn(unknown,protected.values())
            self.assertNotIn(own,protected.values())
            docker('rm','-f',own);start('own',project,'gate')
            self.assertFalse(old.issubset(console.running_containers(['docker'])),'Reproduce the old false-positive check')
            console.verify_protected_containers(['docker'],project,protected)
            docker('stop','--time','2',foreign)
            with self.assertRaisesRegex(RuntimeError,foreign):console.verify_protected_containers(['docker'],project,protected)
            self.assertTrue(original.issubset(console.running_containers(['docker'])))
        finally:
            for name in names:subprocess.run(['docker','rm','-f',name],capture_output=True,check=True)

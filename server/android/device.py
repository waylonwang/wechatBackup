import configparser
import glob
import json
import logging
import os
import re
import shutil
import time

from adb.client import Client as AdbClient
from flask_babel import gettext as _

from config import LOG_NAME, DEVICE_IP, DEVICE_PORT, MM_DB_DIR,\
    MM_RES_DIR

logger = logging.getLogger(LOG_NAME)


class AndroidDevice(AdbClient):
    def __init__(self, host = DEVICE_IP, port = DEVICE_PORT):
        super().__init__(host, port)

    @property
    def current_device(self):
        return self._get_first_device()

    def _save_conf_size(self, project, type, byte):
        cf = configparser.ConfigParser()
        file = f'data/{project}/backup.conf'
        cf.read(file)
        cf.set("size", type, byte)
        cf.write(open(file, "w"))

    def _get_first_device(self):
        try:
            devices = self.devices()
            assert len(devices) > 0
            device = self.devices()[0]
            return device
        except AssertionError:
            return None

    def _is_root(self):
        try:
            device = self._get_first_device()
            assert device
            assert device.shell("whoami").rstrip() == "root"
            return True
        except AssertionError:
            return False

    def _is_insecure_installed(self):
        try:
            device = self._get_first_device()
            assert device
            assert device.is_installed('eu.chainfire.adbd')
            return True
        except AssertionError:
            return False

    def _parse_serial(self):
        try:
            device = self._get_first_device()
            assert device
            return device.serial
        except AssertionError:
            return ''

    def _parse_properties(self):
        try:
            device = self._get_first_device()
            assert device
            return device.get_properties()
        except AssertionError:
            return ''

    def _parse_imei(self, imei_str):
        regex = r"'([^']*)'"
        matches = re.finditer(regex, imei_str, re.MULTILINE)
        mg = []
        for matchNum, match in enumerate(matches, start = 1):
            for groupNum in range(0, len(match.groups())):
                groupNum = groupNum + 1
                mg.append(
                    match.group(groupNum).replace('.', '').rstrip())
        return ''.join(mg).split('\n')

    def _parse_uin(self, uin_str):
        regex = r"default_uin\" value=\"(\-?[0-9]*)"
        matches = re.search(regex, uin_str)
        if matches:
            return matches.group(1)
        else:
            return ''

    def cmd_check_device(self, *args, **kwargs):
        return True, self._parse_serial(), None

    def cmd_check_root(self, *args, **kwargs):
        return True, self._is_root(), None

    def cmd_check_insecure(self, *args, **kwargs):
        return True, self._is_insecure_installed(), None

    def cmd_install_insecure(self, *args, **kwargs):
        from adb import InstallError
        try:
            device = self._get_first_device()
            assert device
            if self._is_insecure_installed():
                assert device.install('resource/adbd-Insecure2.0.apk',
                                      reinstall = True)
            else:
                assert device.install('resource/adbd-Insecure2.0.apk')
            return True, True, _(
                'ADB Insecure has been installed successfully')
        except (AssertionError, InstallError, FileNotFoundError):
            return False, False, _('ADB Insecure installation failed')

    def cmd_get_device_properties(self, *args, **kwargs):
        return True, self._parse_properties(), None

    def cmd_get_users(self, *args, **kwargs):
        try:
            assert self._is_root()
            device = self._get_first_device()
            users = [f for f in
                     device.shell(f'ls {MM_RES_DIR}').split('\r\n') if
                     len(f) == 32]
            users_cnt = len(users)
            return True, users,\
                   _(
                       '{} users have been found, please select the '
                       'users that need to be processed').format(
                       users_cnt) if users_cnt > 0 else\
                       _('No valid users found')
        except AssertionError:
            return False, [],\
                   _(
                       'The rooted Android device has not been '
                       'connected yet')

    def cmd_get_imei(self, *args, **kwargs):
        try:
            assert self._is_root()
            device = self._get_first_device()
            imei = device.shell(f'service call iphonesubinfo 1')
            assert imei
            imei = self._parse_imei(imei)
            return True, imei,\
                   _('Successfully get IMEI: {}').format(imei)
        except AssertionError:
            return False, [], _('Failed to get IMEI')

    def cmd_get_uin(self, *args, **kwargs):
        try:
            assert self._is_root()
            device = self._get_first_device()
            uin = device.shell(
                f'cat {MM_DB_DIR}/shared_prefs/system_config_prefs.xml')
            assert uin
            uin = self._parse_uin(uin)
            return True, uin,\
                   _('Successfully get UIN: {}').format(uin)
        except AssertionError:
            return False, '', _('Failed to get UIN')

    def cmd_delete_file(self, *args, **kwargs):
        taskname = args[0]
        type = kwargs['type']
        path = kwargs['path']
        try:
            if os.path.exists(path):
                if os.path.isdir(path):
                    shutil.rmtree(path)
                else:
                    os.remove(path)
            if type == 'Re':
                self._save_conf_size(taskname, 'resource', '0')
            return True, {'projectName': taskname,
                          'type': type,
                          'success': True}, _(
                '{} was deleted').format(path)
        except OSError as e:
            return False, {'projectName': taskname,
                           'type': type,
                           'success': False}, _(
                'Delete failed, error on operate file')

    def cmd_stop_task(self, *args, **kwargs):
        from server import _daemon

        taskname = args[0]
        if _daemon:
            type = kwargs['type']
            result = _daemon.call(taskname, 'stop')
            return result[0], {'projectName': taskname,
                               'type': type}, result[2]
        else:
            return False, {'projectName': taskname,
                           'type': type}, _('Task daemon not started')

    def cmd_get_exist_projects(self, *args, **kwargs):
        """获取已存在项目命令

        :param args:
        :param kwargs:
        :return: 获取结果
        """

        def folder_size(path):
            import subprocess
            return int(
                subprocess.check_output(['du', '-sk', path]).split()[
                    0].decode('utf-8')) * 1024

        projects = {}
        cf = configparser.ConfigParser()
        for conf in glob.glob(f'data/*/backup.conf'):
            cf.read(conf)
            name = cf.get('project', 'name')
            projects[name] = {
                'user': cf.get('project', "user"),
                'password': cf.get('project', 'password'),
                'files': [(f, os.stat(f).st_size) for f in
                          glob.glob(f'data/{name}/??MicroMsg.db')] + [
                             (f, int(cf.get('size', 'resource'))) for f
                             in
                             glob.glob(f'data/{name}/Resource')]
            }
        return True, json.dumps(projects), None

    def cmd_create_project(self, *args, **kwargs):
        """创建备份项目命令

        :param args: 包含项目名称
        :param kwargs: 包含user,password键值对
        :return: 创建结果
        """
        try:
            name = args[0]
            if not os.path.exists(f'data/{name}'):
                os.makedirs(f'data/{name}')
            cf = configparser.ConfigParser()
            cf.add_section("project")
            cf.set("project", "name", name)
            cf.set("project", "user", kwargs["user"])
            cf.set("project", "password", kwargs["password"])
            cf.add_section("size")
            cf.set("size", "resource", "0")
            cf.write(open(f'data/{name}/backup.conf', "w"))
            return True, name, _('Project create...')
        except OSError as e:
            return False, None, _('Failed to create project')

    def cmd_check_db_size(self, *args, **kwargs):
        """检查数据库拉取命令

        用于拉取数据库时检查进度

        :param args:
        :param kwargs: 包含progress为检查进度的方法
        :return: 检查结果
        """
        progress = kwargs['progress']
        return True, progress(), None

    def alive_check_db_size(self, *args, **kwargs):
        """检查数据库拉取存活状态

        :param args:
        :param kwargs: 包含progress为检查进度的方法
        :return: 是否存活
        """
        progress = kwargs['progress']
        data = progress()
        if data['progress'] == 1:
            time.sleep(kwargs["interval"])
            return False
        else:
            return True

    def cmd_check_decrypt_progress(self, *args, **kwargs):
        """检查数据库解密进度命令

        用于解密数据库时检查进度

        :param args:
        :param kwargs: 包含progress为检查进度的方法
        :return: 检查结果
        """
        progress = kwargs['progress']
        return True, progress(), None

    def alive_check_decrypt_progress(self, *args, **kwargs):
        """检查数据库解密存活状态

        :param args:
        :param kwargs: 包含progress为检查进度的方法
        :return: 是否存活
        """
        progress = kwargs['progress']
        data = progress()
        if data['progress'] == 1:
            time.sleep(kwargs["interval"])
            return False
        else:
            return True

    def cmd_check_resource_progress(self, *args, **kwargs):
        """检查资源进度命令

        用于拉取资源时检查进度

        :param args:
        :param kwargs: 包含progress为检查进度的方法
        :return: 检查结果
        """
        progress = kwargs['progress']
        data = progress()
        self._save_conf_size(data['projectName'], 'resource',
                             str(data['current'] * 1024))
        return True, data, None

    def alive_check_resource_progress(self, *args, **kwargs):
        """检查资源拉取存活状态

        :param args:
        :param kwargs: 包含progress为检查进度的方法
        :return: 是否存活
        """
        progress = kwargs['progress']
        data = progress()
        if data['progress'] == 1:
            time.sleep(kwargs["interval"])
            return False
        else:
            return True


_client = AndroidDevice()

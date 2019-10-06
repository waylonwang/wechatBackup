import base64
import io
import logging
import os
import subprocess
import tarfile
import time

from adb.sync import Sync as AdbSync
from flask_babel import gettext as _
from pysqlcipher3 import dbapi2 as sqlite

from config import LOG_NAME, MM_DB_DIR, MM_RES_DIR, MM_DB_ENCODE_NAME,\
    MM_DB_DECODE_NAME
from ..task import TaskRunner, HeartbeatRunner, OnceRunner

logger = logging.getLogger(LOG_NAME)


class DBPullRunnerInitError(RuntimeError):
    pass


class DbDecryptRunnerInitError(RuntimeError):
    pass


class ResPullRunnerInitError(RuntimeError):
    pass


class DbPullRunner(TaskRunner):
    """数据库拉取运行器
    """
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        try:
            params = kwargs.get('params', None)
            assert params
            self._device = params.get('device', None)
            assert self._device
            self._device = self._device.current_device
            self._connection = self._device.sync()

            self._user = params.get('user', None)
            assert self._user

            self._task_alive_timeout = params.get('timeout', 10)
            self._task_alive_timestamp = time.time()
        except AssertionError:
            raise DBPullRunnerInitError()

        self._src_name = f'{MM_DB_ENCODE_NAME}.db'
        self._dest_name = f'{MM_DB_ENCODE_NAME}.db'
        self._src_path = f'{MM_DB_DIR}/MicroMsg/{self._user}/'\
                         f'{MM_DB_ENCODE_NAME}.db'
        self._dest_path = f'data/{self.name}/'\
                          f'{self._dest_name}'
        self._src_byte = self._remote_byte(self._src_path)
        self._dest_byte = -1

        self._pull_db_error = False

    def _on_before_runloop(self):
        if not os.path.exists(f'data/{self.name}'):
            os.makedirs(f'data/{self.name}')
        self._add_checker()

    def _on_runloop(self):
        try:
            logger.debug(
                f"[{self.name}] DbPullRunner connection closed "
                f"status: {self._connection.socket._closed}")
            if not self._connection.socket._closed:
                sync = AdbSync(self._connection)
                with self._connection:
                    logger.debug(
                        f"[{self.name}] DbPullRunner pull db start")
                    sync.pull(self._src_path, self._dest_path)
                    logger.debug(
                        f"[{self.name}] DbPullRunner pull db end")
        except OSError as e:
            logger.debug(
                f"[{self.name}] DbPullRunner pull db error: {e}")
            if not self._stop_by_user:
                self._pull_db_error = True
        finally:
            logger.debug(
                f"[{self.name}] DbPullRunner pull db finish")
            self.stop()

    def _on_before_stop(self):
        self._connection.close()

    def is_task_alive(self):
        alive = True
        try:
            size = self._local_byte(self._dest_path)
            if size != self._dest_byte:
                self._dest_byte = size
                self._task_alive_timestamp = time.time()
            elif time.time() - self._task_alive_timestamp >\
                    self._task_alive_timeout:
                alive = False
        except Exception:
            alive = False
            logger.debug(
                f"[{self.name}] DbPullRunner alive error: {alive}")
        finally:
            return alive

    def is_kill_when_stop(self):
        return True

    def is_pull_db_error(self):
        return self._pull_db_error

    def progress(self):
        logger.debug(f"[{self.name}] DbPullRunner progress start")
        if self.is_pull_db_error():
            logger.debug(f"[{self.name}] DbPullRunner progress error")
            return {"projectName": self.name,
                    "progress": -1,
                    "filename": self.dest_name,
                    "path": self.dest_path,
                    'src_byte': -1,
                    'dest_byte': -1}
        elif self.src_byte > self.dest_byte:
            p = float(str(self.dest_byte / self.src_byte)[:6])
            logger.debug(f"[{self.name}] DbPullRunner progress p: {p}")
            return {"projectName": self.name,
                    "progress": p,
                    "filename": self.dest_name,
                    "path": self.dest_path,
                    'src_byte': self.src_byte,
                    'dest_byte': self.dest_byte}
        elif self.src_byte == self.dest_byte:
            logger.debug(f"[{self.name}] DbPullRunner progress 100%")
            return {"projectName": self.name,
                    "progress": 1,
                    "filename": self.dest_name,
                    "path": self.dest_path,
                    'src_byte': self.src_byte,
                    'dest_byte': self.dest_byte}

    @property
    def dest_byte(self):
        self._dest_byte = self._local_byte(self._dest_path)
        return self._dest_byte

    @property
    def dest_path(self):
        return self._dest_path

    @property
    def dest_name(self):
        return self._dest_name

    @property
    def src_byte(self):
        return self._src_byte

    @property
    def src_path(self):
        return self._src_path

    @property
    def src_name(self):
        return self._src_name

    def _local_byte(self, path):
        try:
            if os.path.exists(path):
                return os.stat(path).st_size
            else:
                return 0
        except OSError:
            return 0

    def _remote_byte(self, path):
        return int(
            self._device.shell(f'stat -c%s {path}').replace('\r\n', ''))

    def _get_stop_success_message(self):
        return _('Pull has been stopped')

    def _get_stop_fail_message(self):
        return _('Stop pull was failed')

    def _add_checker(self):
        from server import _daemon
        _daemon.add_task(HeartbeatRunner,
                         f'Db size checker - {self.name}',
                         callback = self._callback,
                         params = {'command': "check_db_size",
                                   'interval': 1,
                                   'progress': self.progress})


class DbDecryptRunner(TaskRunner):
    """数据库解密运行器
    """
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        try:
            params = kwargs.get('params', None)
            assert params
            self._password = params.get('password', None)
            assert self._password

            self._task_alive_timeout = params.get('timeout', 10)
            self._task_alive_timestamp = time.time()
        except AssertionError:
            raise DbDecryptRunnerInitError()

        self._src_db_filename = f'{MM_DB_ENCODE_NAME}.db'
        self._dest_db_filename = f'{MM_DB_DECODE_NAME}.db'
        self._src_db_path = f'data/{self.name}/{self._src_db_filename}'
        self._dest_db_path = f'data/{self.name}/'\
                             f'{self._dest_db_filename}'
        self._src_db_byte = self._local_byte(self._src_db_path)

        self._temp_file = [
            f'data/{self.name}/{self._src_db_filename}-migrated',
            f'{self._dest_db_path}']
        self._temp_file_byte = -1

        self._step_names = [_('Migrating'),
                            _('Decrypting')]
        self._step_processs = [getattr(self, '_on_step_migrate'),
                               getattr(self, '_on_step_decrypt')]
        self._step = 0

    def _on_before_runloop(self):
        self._add_checker()

    def _on_runloop(self):
        if self._step < len(self._step_processs):
            logger.debug(
                f"[{self.name}] DbDecryptRunner run step: {self._step}")
            self._step_processs[self._step]()
            self._step = self._step + 1

    def _on_step_migrate(self):
        logger.debug(f"[{self.name}] DbDecryptRunner migrate start")
        conn = sqlite.connect(self._src_db_path)
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA key = '" + self._password + "';")
            cursor.execute("PRAGMA cipher_migrate;")
        except:
            logger.debug(f"[{self.name}] DbDecryptRunner migrate error")
        finally:
            cursor.close()
        logger.debug(f"[{self.name}] DbDecryptRunner migrate end")

    def _on_step_decrypt(self):
        logger.debug(f"[{self.name}] DbDecryptRunner decrypt start")
        conn = sqlite.connect(self._src_db_path)
        cursor = conn.cursor()
        try:
            cursor.execute("PRAGMA key = '" + self._password + "';")
            cursor.execute("PRAGMA cipher_use_hmac = OFF;")
            cursor.execute("PRAGMA cipher_use_hmac = SHA512;")
            cursor.execute("PRAGMA cipher_page_size = 4096;")
            cursor.execute("PRAGMA kdf_iter = 256000;")
            cursor.execute("ATTACH DATABASE '"
                           + self._dest_db_path
                           + "' AS db KEY '';")
            cursor.execute("SELECT sqlcipher_export('db');")
            cursor.execute("DETACH DATABASE db;")
        except Exception as e:
            logger.debug(f"[{self.name}] DbDecryptRunner decrypt error")
        finally:
            cursor.close()
        logger.debug(f"[{self.name}] DbDecryptRunner decrypt end")

    def is_task_alive(self):
        alive = True
        try:
            size = self._local_byte(self._temp_file[self._step])
            if size != self._temp_file_byte:
                self._temp_file_byte = size
                self._task_alive_timestamp = time.time()
            elif time.time() - self._task_alive_timestamp >\
                    self._task_alive_timeout:
                alive = False
            if self._step >= len(self._step_processs):
                alive = False
        except Exception:
            alive = False
        finally:
            return alive

    def is_kill_when_stop(self):
        return True

    def progress(self):
        logger.debug(f"[{self.name}] DbDecryptRunner progress start")
        if self._step < len(self._step_processs):
            size = self._local_byte(self._temp_file[self._step])
            logger.debug(
                f"[{self.name}] DbDecryptRunner progress size: {size}")
            p = float(str((size / self._src_db_byte / len(
                self._step_processs)) + 0.5 * self._step)[:6])
            logger.debug(
                f"[{self.name}] DbDecryptRunner progress p: {p}")
            return {"projectName": self.name,
                    "progress": p,
                    "filename": self._temp_file[self._step],
                    "step_name": self._step_names[self._step],
                    "path": self._temp_file[self._step],
                    "byte": size}
        else:
            logger.debug(f"[{self.name}] DbDecryptRunner progress 100%")
            size = self._local_byte(self._dest_db_path)
            return {"projectName": self.name,
                    "progress": 1,
                    "filename": self._dest_db_filename,
                    "step_name": _('Decryption completed'),
                    "path": self._dest_db_path,
                    "byte": size}

    def _local_byte(self, path):
        try:
            if os.path.exists(path):
                return os.stat(path).st_size
            else:
                return 0
        except OSError:
            return 0

    def _add_checker(self):
        from server import _daemon
        _daemon.add_task(HeartbeatRunner,
                         f'Decrypt checker - {self.name}',
                         callback = self._callback,
                         params = {'command': "check_decrypt_progress",
                                   'interval': 1,
                                   'progress': self.progress})


class ResPullRunner(TaskRunner):
    """资源拉取运行器
    """
    def __init__(self, **kwargs):
        super().__init__(**kwargs)

        try:
            params = kwargs.get('params', None)
            assert params
            self._device = params.get('device', None)
            assert self._device
            self._device = self._device.current_device
            self._connection = self._device.sync()

            self._user = params.get('user', None)
            assert self._user

            self._task_alive_timeout = params.get('timeout', 10)
            self._task_alive_byte = -1
            self._task_alive_timestamp = time.time()
        except AssertionError:
            raise ResPullRunnerInitError()

        self._src_path = f'{MM_RES_DIR}/{self._user}/'
        self._dest_path = f'data/{self.name}/Resource'
        self._src_byte = -1
        self._dest_byte = -1

        self._folder = ['avatar', 'emoji', 'sfs', 'voice2', 'image2',
                        'video']
        self._folder_byte = []

        self._step_names = [_('Counting')]
        self._step_processs = [(getattr(self, '_run_step_count'), None)]
        for folder in self._folder:
            self._step_names.append(_('Pulling {}').format(folder))
            self._step_processs.append(
                (getattr(self, '_run_step_pull'), folder))
        self._step = 0
        self._index = 0

        self._pull_error = False

    def _on_before_runloop(self):
        for folder in self._folder:
            if not os.path.exists(self._dest_path + '/' + folder):
                os.makedirs(self._dest_path + '/' + folder)
        self._add_checker()

    def _on_before_stop(self):
        self._connection.close()

    def _on_runloop(self):
        try:
            if 0 <= self._step < len(self._step_processs):
                logger.debug(
                    f"[{self.name}] ResPullRunner run step: "
                    f"{self._step}")
                self._step_processs[self._step][0](
                    self._step_processs[self._step][1])
            else:
                self.stop()
        except OSError as e:
            if not self._stop_by_user:
                self._pull_error = True
        finally:
            self._step = self._step + 1

    def _run_step_count(self, nothing):
        for folder in self._folder:
            self._folder_byte.append(
                self._remote_byte(self._src_path + folder))
        self._src_byte = sum(self._folder_byte)

    # def _run_step_pull(self, folder):
    #     stream_base64 = self._device.shell(
    #         f"cd {self._src_path} && busybox tar czf - "
    #         f"{folder} 2>/dev/null | busybox base64")
    #     stream_bytes = base64.standard_b64decode(stream_base64)
    #     stream_file = io.BytesIO(stream_bytes)
    #     tar = tarfile.open(fileobj = stream_file, mode = 'r:gz')
    #     file_names = tar.getnames()
    #     for file_name in file_names:
    #         tar.extract(file_name, self._dest_path)
    #     tar.close()

    def _run_step_pull(self, folder):
        subpaths = self._device.shell(
            f"ls {self._src_path}{folder}").split('\r\n')
        for path in subpaths:
            stream_base64 = self._device.shell(
                f"cd {self._src_path}{folder} && busybox tar czf - "
                f"{path} 2>/dev/null | busybox base64")
            stream_bytes = base64.standard_b64decode(stream_base64)
            stream_file = io.BytesIO(stream_bytes)
            try:
                tar = tarfile.open(fileobj = stream_file,
                                   mode = 'r' or 'r:*')
                file_names = tar.getnames()
                for file in file_names:
                    tar.extract(file, f'{self._dest_path}/{folder}')
                tar.close()
            except tarfile.ReadError:
                pass

    def is_task_alive(self):
        alive = True
        try:
            size = self._dest_byte
            if size != self._task_alive_byte:
                logger.debug(
                    f"[{self.name}] ResPullRunner update timestamp "
                    f"{size}")
                self._task_alive_byte = size
                self._task_alive_timestamp = time.time()
            elif time.time() - self._task_alive_timestamp >\
                    self._task_alive_timeout:
                logger.debug(
                    f"[{self.name}] ResPullRunner not alive (timeout)")
                alive = False
            if self._step >= len(self._step_processs):
                logger.debug(
                    f"[{self.name}] ResPullRunner not alive (stepout)")
                alive = False
        except Exception:
            logger.debug(
                f"[{self.name}] ResPullRunner not alive (exception)")
            alive = False
        finally:
            return alive

    def is_kill_when_stop(self):
        return True

    def progress(self):
        self._dest_byte = self._local_byte(self._dest_path)
        if self._stopped.is_set():
            if self._step < len(self._step_processs):  # timeout
                logger.debug(f"[{self.name}] ResPullRunner timeout")
                return {"projectName": self.name,
                        "progress": 0,
                        "folder": '',
                        "step": -1,
                        "step_name": _('Resouce pull timeout'),
                        "path": '',
                        "byte": 0,
                        "current": 0}
            else:  # finish
                logger.debug(
                    f"[{self.name}] ResPullRunner progress 100%")
                return {"projectName": self.name,
                        "progress": 1,
                        "folder": self._dest_path,
                        "step": -1,
                        "step_name": _('Resouce pull completed'),
                        "path": self._dest_path,
                        "byte": self._dest_byte,
                        "current": self._dest_byte}
        else:
            if 0 < self._step < len(self._step_processs):  # pulling
                p = float(str(self._dest_byte / self._src_byte)[:6])
                return {"projectName": self.name,
                        "progress": p,
                        "folder": self._folder[self._step - 1],
                        "step": self._step,
                        "step_name": self._step_names[self._step],
                        "path": self._dest_path + self._folder[
                            self._step - 1],
                        'byte': self._src_byte,
                        "current": self._dest_byte}
            elif self._step == 0:  # init
                return {"projectName": self.name,
                        "progress": 0,
                        "folder": '',
                        "step": 0,
                        "step_name": self._step_names[self._step],
                        "path": '',
                        "byte": 0,
                        "current": 0}

    def is_pull_error(self):
        return self._pull_db_error

    def _local_byte(self, path):
        return int(subprocess.check_output(['du', '-sk', path]).split()[
                       0].decode('utf-8'))

    def _remote_byte(self, path):
        return int(
            self._device.shell(f"du -sk {path}").split()[0])

    def _get_stop_success_message(self):
        return _('Pull has been stopped')

    def _get_stop_fail_message(self):
        return _('Stop pull was failed')

    def _add_checker(self):
        from server import _daemon
        _daemon.add_task(HeartbeatRunner,
                         f'Resource progress checker - {self.name}',
                         callback = self._callback,
                         params = {'command': "check_resource_progress",
                                   'interval': 1,
                                   'progress': self.progress})


task_categories = {
    'heartbeat': HeartbeatRunner,
    'once': OnceRunner,
    'pull_db': DbPullRunner,
    'decrypt': DbDecryptRunner,
    'pull_res': ResPullRunner
}

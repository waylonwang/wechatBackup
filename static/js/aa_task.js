/**
 * 添加后台任务
 *
 * 任务参数按以下格式提交
 * {
 *     name: #[必选]名称
 *     category: #[必选]类别
 *     params: #[可选]参数
 * }
 *
 * @param args 任务参数
 */
function addTask(args) {
    if (isServerConnected(true)) {
        args["channel"] = "android";
    }
    socketio.emit("add_task", args, callback = addTaskCallback);
}

/**
 * 杀死后台任务
 * @param taskname 任务名
 */
function killTask(taskname) {
    socketio.emit("kill_task", {name: taskname, channel: "android"});
}

/**
 * 添加后台任务的回调
 * @param command 命令名
 * @param name 任务名
 * @param success 是否成功
 * @param data 业务数据
 * @param message 提示消息
 */
function addTaskCallback(command, name, success, data, message) {
    var isNoName = name === null || name === undefined || name === "";
    var isNoMessage = message === null || message === undefined || message === "";
    isNoMessage ? null : sendOutput(message, success ? OutputType.STDOUT : OutputType.ERROR);
    // isNoName ? null : sendOutput(decodeURI(name) + _(" → Task execution completed"), OutputType.STATUS);
}

/**
 * 任务执行回调
 * @param command 命令名
 * @param name 任务名
 * @param success 是否成功
 * @param data 业务数据
 * @param message 提示消息
 */
function taskResponse(command, name, success, data, message) {
    var isNoMessage = message === null || message === undefined || message === "";
    try {
        eval(camelize.prepended("onPreTaskResponse", command) + "(data)");
    } catch (e) {
        if (e instanceof ReferenceError) {
            // do nothing
        } else {
            sendOutput(e, OutputType.ERROR);
        }
    }
    isNoMessage ? null : sendOutput(message, success ? OutputType.STDOUT : OutputType.ERROR);
    try {
        eval(camelize.prepended("onPostTaskResponse", command) + "(data)");
    } catch (e) {
        if (e instanceof ReferenceError) {
            // do nothing
        } else {
            sendOutput(e, OutputType.ERROR);
        }
    }
}

/**
 * 检查设备连接状态的前置响应
 * @param data 响应数据
 */
function onPreTaskResponseCheckDevice(data) {
    var deviceSerial = data;
    var latestSerial = $("#status_device").attr("data-serial");
    if (deviceSerial !== "" && latestSerial !== deviceSerial) {
        $("#status_device").attr("data-serial", deviceSerial);
        execCommand({
            name: encodeURI(_("Get device properties")),
            command: "get_device_properties",
        }, true);
    }
}

/**
 * 检查设备连接状态的后置响应
 * @param data 响应数据
 */
function onPostTaskResponseCheckDevice(data) {
    var deviceSerial = data;
    if (deviceSerial === "" && fsmDevice.can("disconnect-device")) {
        fsmDevice.disconnectDevice();
    } else if (deviceSerial !== "" && fsmDevice.can("connect-device")) {
        fsmDevice.connectDevice();
    }
}

/**
 * 检查Root状态的前置响应
 * @param data 响应数据
 */
function onPreTaskResponseCheckRoot(data) {
    var hasRooted = data;
    var latest = $("#status_root").attr("data-rooted");
    var isSendOutput =
        (latest === "true" ? false : !(latest == hasRooted.toString()));
    $("#status_root").attr("data-rooted", hasRooted)
                     .attr("data-remindonce", isSendOutput);
    if (hasRooted) {
        updateDropdownValidity("root", false);
    }
}

/**
 * 检查Root状态的后置响应
 * @param data 响应数据
 */
function onPostTaskResponseCheckRoot(data) {
    var hasRooted = data;
    if (!hasRooted && fsmDevice.can("deny-root")) {
        fsmDevice.denyRoot();
    } else if (hasRooted && fsmDevice.can("access-root")) {
        fsmDevice.accessRoot();
    }
    if (!hasRooted && fsmDevice.state === "device-ready") {
        execCommand({
            name: encodeURI(_("Check insecure")),
            command: "check_insecure",
        }, true);
    }
}

/**
 * 创建项目的前置响应
 * @param data 响应数据
 */
function onPreTaskResponseCreateProject(data) {
    if (data != null) {
        var projectName = data;
        backupFSM[projectName].waitPullDb();
    }
}

/**
 * 获取已存在项目的前置响应
 * @param data 响应数据
 */
function onPreTaskResponseGetExistProjects(data) {
    clearProjectBrowserContent();
    if (data) {
        data = JSON.parse(data);
        if (data != null) {
            var projectList = parseExistProjects(data);
            for (let projectName of projectList) {
                backupFSM[projectName].createBackupItem(true);
            }
        }
    }
    updateProjectBrowserDisplay(true);
}

/**
 * 检查数据库拉取进度的前置响应
 * @param data 响应数据
 */
function onPreTaskResponseCheckDbSize(data) {
    if (data !== null) {
        var fsm = backupFSM[data.projectName];
        if (fsm === null || fsm === undefined) {
            return;
        }
        fsm.setFile(FileType.ENCRYPT, data.path, data.src_byte);
        if (fsm.can("start-pull-db")) {
            fsm.startPullDb();
        }
    }
}

/**
 * 检查数据库拉取进度的后置响应
 * @param data 响应数据
 */
function onPostTaskResponseCheckDbSize(data) {
    if (data !== null) {
        var fsm = backupFSM[data.projectName];
        if (fsm === null || fsm === undefined) {
            return;
        }
        fsm[FileType.ENCRYPT].current = data.dest_byte;
        fsm[FileType.ENCRYPT].progress = data.progress;
        updateDbPullProgress(fsm);
    }
}

/**
 * 检查数据库解密的前置响应
 * @param data 响应数据
 */
function onPreTaskResponseCheckDecryptProgress(data) {
    if (data !== null) {
        var fsm = backupFSM[data.projectName];
        if (fsm === null || fsm === undefined) {
            return;
        }
        if (fsm.can("start-decrypt-db")) {
            fsm.startDecryptDb();
        }
    }
}

/**
 * 检查数据库解密进度的后置响应
 * @param data 响应数据
 */
function onPostTaskResponseCheckDecryptProgress(data) {
    if (data != null) {
        var fsm = backupFSM[data.projectName],
            path = data.path;
        if (fsm === null || fsm === undefined) {
            return;
        }
        if (data.progress >= 1) {
            path = data.filename;
        }
        fsm.setFile(FileType.DECRYPT, data.path, data.byte);
        fsm[FileType.DECRYPT].step = data.step_name;
        fsm[FileType.DECRYPT].progress = data.progress;
        updateDecryptProgress(fsm);
    }
}

/**
 * 检查资源拉取的前置响应
 * @param data 响应数据
 */
function onPreTaskResponseCheckResourceProgress(data) {
    if (data !== null) {
        var fsm = backupFSM[data.projectName];
        if (fsm === null || fsm === undefined) {
            return;
        }
        if (fsm.can("start-pull-res")) {
            fsm.startPullRes();
        }
    }
}

/**
 * 检查资源拉取进度的后置响应
 * @param data 响应数据
 */
function onPostTaskResponseCheckResourceProgress(data) {
    if (data != null) {
        var fsm = backupFSM[data.projectName],
            path = data.path;
        if (fsm === null || fsm === undefined) {
            return;
        }
        fsm.setFile(FileType.RESOURCE, data.path, data.byte * 1024);
        fsm[FileType.RESOURCE].step = data.step;
        fsm[FileType.RESOURCE].step_name = data.step_name;
        fsm[FileType.RESOURCE].progress = data.progress;
        fsm[FileType.RESOURCE].current = data.current * 1024;
        updateResourceProgress(fsm);
    }
}


$(function () {
    socketio.on("task_response", taskResponse);
});
// 文件类型
const FileType = {
    ENCRYPT: "En",
    DECRYPT: "De",
    RESOURCE: "Re",
};

// 备份状态
const BackupState = {
    INIT: "init",
    WAITING: "waiting",
    DBPULLING: "db-pulling",
    DBPULLED: "db-pulled",
    DECRYPTING: "db-decrypting",
    DECRYPTED: "db-decrypted",
    RESPULLING: "res-pulling",
    RESPULLED: "res-pulled",
};

// 条目状态
const ItemStatus = {
    QUEUE: "queue",
    DOING: "doing",
    DONE: "done",
};

// 备份状态机字典
var backupFSM = {};

// 备份状态机
var BackupStateMachine = new StateMachine.factory({
    init: "init",
    transitions: [
        {
            name: "wait-pull-db",
            from: BackupState.INIT,
            to: BackupState.WAITING,
        },
        {
            name: "start-pull-db",
            from: BackupState.WAITING,
            to: BackupState.DBPULLING,
        },
        {
            name: "stop-pull-db",
            from: BackupState.DBPULLING,
            to: BackupState.WAITING,
        },
        {
            name: "finish-pull-db",
            from: [BackupState.INIT, BackupState.DBPULLING],
            to: BackupState.DBPULLED,
        },
        {
            name: "delete-pulled-db",
            from: BackupState.DBPULLED,
            to: BackupState.WAITING,
        },
        {
            name: "start-decrypt-db",
            from: BackupState.DBPULLED,
            to: BackupState.DECRYPTING,
        },
        {
            name: "stop-decrypt-db",
            from: BackupState.DBPULLING,
            to: BackupState.DBPULLED,
        },
        {
            name: "finish-decrypt-db",
            from: [BackupState.INIT, BackupState.DECRYPTING],
            to: BackupState.DECRYPTED,
        },
        {
            name: "delete-decrypted-db",
            from: BackupState.DECRYPTED,
            to: BackupState.DBPULLED,
        },
        {
            name: "start-pull-res",
            from: BackupState.DECRYPTED,
            to: BackupState.RESPULLING,
        },
        {
            name: "stop-pull-res",
            from: BackupState.RESPULLING,
            to: BackupState.DECRYPTED,
        },
        {
            name: "finish-pull-res",
            from: [BackupState.INIT, BackupState.RESPULLING],
            to: BackupState.RESPULLED,
        },
        {
            name: "delete-pulled-res",
            from: BackupState.RESPULLED,
            to: BackupState.DECRYPTED,
        },
        {
            name: "goto",
            from: "*",
            to: function (s) { return s; },
        },
    ],
    data: {
        project: {
            name: "",
            time: "",
            id: "",
            password: "",
            user: "",
        },
        [FileType.ENCRYPT]: {
            name: "",
            progress: "",
            path: "",
            byte: 0,
            size: "0.00 MB",
            current: 0,
        },
        [FileType.DECRYPT]: {
            name: "",
            step: "",
            progress: "",
            path: "",
            byte: 0,
            size: "0.00 MB",
        },
        [FileType.RESOURCE]: {
            name: "",
            step: 0,
            step_name: "",
            progress: "",
            path: "",
            byte: 0,
            size: "0.00 MB",
            current: 0,
        },
    },
    methods: {
        initBackup: function (projectName, user, password) {
            var p = projectName.split("_");
            this.project = {};
            this.project["name"] = projectName;
            this.project["time"] = p[0].substr(0, 4) + "-" + p[0].substr(4, 2) + "-" + p[0].substr(6, 2)
                + " " + p[0].substr(8, 2) + ":" + p[0].substr(10, 2) + ":" + p[0].substr(12, 2);
            this.project["id"] = p[1];
            this.project["user"] = user;
            this.project["password"] = password;
        },
        setFile: function (type, path, byte) {
            this[type] = {};
            this[type]["name"] = path.replace(/^.*[\\\/]/, "");
            this[type]["path"] = path;
            this[type]["byte"] = Number(byte);
            this[type]["size"] = ((byte == 0 ? "0.00" : Number((byte / 1024 / 1024).toString().match(/^\d+(?:\.\d{0,2})?/))) + " MB");
        },
        clearFile: function (type) {
            this[type]["byte"] = 0;
            this[type]["size"] = "0.00 MB";
            setDoneItem(this, type, $("#item_done_" + type + "_" + this.project.name));
            updateItemButtonStatus(this, type, ItemStatus.DONE);
        },
        createBackupItem: function (immediate) {
            createBackupItem(this, immediate);
        },
        onEnterState: function (lifecycle) {
            updateProjectQueueButtonStatus(this);
        },
        onAfterWaitPullDb: function (lifecycle) {
            this.createBackupItem();
            if (fsmDevice.state !== "root-ready") {
                this.goto(BackupState.INIT);
            }
        },
        onBeforeStartPullDb: function (lifecycle) {
            sendFootInfo(lifecycle);
            switchQueueToDoing(this, FileType.ENCRYPT);
        },
        onBeforeFinishPullDb: function (lifecycle) {
            sendFootInfo(lifecycle);
            switchDoingToDone(this, FileType.ENCRYPT);
        },
        onBeforeDeletePulledDb: function (lifecycle) {
            switchDoneToQueue(this, FileType.ENCRYPT);
        },
        onBeforeStartDecryptDb: function (lifecycle) {
            sendFootInfo(lifecycle);
            switchQueueToDoing(this, FileType.DECRYPT);
        },
        onBeforeFinishDecryptDb: function (lifecycle) {
            sendFootInfo(lifecycle);
            switchDoingToDone(this, FileType.DECRYPT);
        },
        onBeforeDeleteDecryptedDb: function (lifecycle) {
            switchDoneToQueue(this, FileType.DECRYPT);
        },
        onAfterDeleteDecryptedDb: function (lifecycle) {
            if (this[FileType.ENCRYPT].byte === 0) {
                var fsm = this;
                setTimeout(function () {
                    fsm.deletePulledDb();
                }, 1000);
            }
        },
        onBeforeStartPullRes: function (lifecycle) {
            sendFootInfo(lifecycle);
            switchQueueToDoing(this, FileType.RESOURCE);
        },
        onBeforeFinishPullRes: function (lifecycle) {
            sendFootInfo(lifecycle);
            switchDoingToDone(this, FileType.RESOURCE);
        },
        onBeforeDeletePulledRes: function (lifecycle) {
            switchDoneToQueue(this, FileType.RESOURCE);
        },
        onAfterDeletePulledRes: function (lifecycle) {
            if (this[FileType.DECRYPT].byte === 0) {
                var fsm = this;
                setTimeout(function () {
                    fsm.deleteDecryptedDb();
                }, 1000);
            }
        },
    },
});

/**
 * 创建备份计划
 */
function createBackupProject() {
    var projectName = generateProjectName(),
        user = $("#user").val(),
        password = $("#password").val();
    $("#btn_project").attr("data-project", projectName);
    backupFSM[projectName] = new BackupStateMachine();
    backupFSM[projectName].initBackup(projectName, user, password);
    addTask({
        name: projectName,
        category: "once",
        params: {
            command: "create_project",
            user: user,
            password: password,
        },
    });
}

/**
 * 创建备份条目
 * @param fsm 备份状态机
 * @param immediate 是否立即显示(false为下拉滑动显示)
 */
function createBackupItem(fsm, immediate) {
    var item = $("#template_project").clone();
    item.attr("id", "project_" + fsm.project.name)
        .attr("project", fsm.project.name);
    item.find(".project-name .status-label").text(fsm.project.time);
    item.find(".project-password .status-label").text(fsm.project.password);
    item.find(".project-user .status-label").text(fsm.project.user.substring(0,8)+"..."+fsm.project.user.slice(-8));
    item.prependTo($(".project-browser"));

    var fileStatus = {
        [FileType.ENCRYPT]: [
            [BackupState.WAITING],
            [BackupState.DBPULLED, BackupState.DECRYPTED, BackupState.RESPULLED],
        ],
        [FileType.DECRYPT]: [
            [BackupState.WAITING, BackupState.DBPULLED],
            [BackupState.DECRYPTED, BackupState.RESPULLED],
        ],
        [FileType.RESOURCE]: [
            [BackupState.WAITING, BackupState.DBPULLED, BackupState.DECRYPTED],
            [BackupState.RESPULLED],
        ],
    };

    for (let type in fileStatus) {
        if (fileStatus[type][0].includes(fsm.state)) {
            setQueueItem(fsm, type);
        } else if (fileStatus[type][1].includes(fsm.state)) {
            setDoneItem(fsm, type);
        }
    }

    if (immediate) {
        item.show();
    } else {
        item.stop().slideDown(500, "swing");
    }
}

/**
 * 从模板克隆条目
 * @param projectName 备份计划名
 * @param type 文件类型
 * @param status 条目状态
 * @param target 替换目标
 * @returns {MediaStream | Response | MediaStreamTrack | Request | * | jQuery}
 */
function cloneItemFromTemplate(projectName, type, status, target) {
    var item = $("#template_" + status).clone();
    item.attr("id", "item_" + status + "_" + type + "_" + projectName)
        .show();

    if (target === null || target === undefined) {
        item.appendTo($("#project_" + projectName).find(".project-files"));
    } else {
        target.replaceWith(item);
    }
    return item;
}

/**
 * 设置已完成条目
 * @param fsm 备份状态机
 * @param type 文件类型
 * @param target 替换目标
 */
function setDoneItem(fsm, type, target) {
    var projectName = fsm.project.name;
    var file = fsm[type];
    var icons = {
        [FileType.ENCRYPT]: ["database", "lock"],
        [FileType.DECRYPT]: ["database", "lock-open"],
        [FileType.RESOURCE]: ["images"],
    }, file_names = {
        [FileType.ENCRYPT]: _("Encryption database"),
        [FileType.DECRYPT]: _("Decryption database"),
        [FileType.RESOURCE]: _("Resource"),
    };
    var item = cloneItemFromTemplate(projectName, type, ItemStatus.DONE, target);

    updateItemContent("name", projectName, type, ItemStatus.DONE, file_names[type]);
    updateItemContent("size", projectName, type, ItemStatus.DONE, file.size);
    updateItemButtonStatus(fsm, type, ItemStatus.DONE);

    for (let icon of icons[type]) {
        item.find(".fa-" + icon).show();
    }

    item.find("#btn_delete")
        .on("click", function () {
            execCommand({
                name: projectName,
                command: "delete_file",
                params: {
                    type: type,
                    path: file.path,
                },
            }, true);
        });

}

/**
 * 设置在等候条目
 * @param fsm 备份状态机
 * @param type 文件类型
 * @param target 替换目标
 */
function setQueueItem(fsm, type, target) {
    var projectName = fsm.project.name;
    var password = fsm.project.password;
    var user = fsm.project.user;
    var icons = {
        [FileType.ENCRYPT]: ["database", "lock", "download"],
        [FileType.DECRYPT]: ["database", "unlock", "lock-open"],
        [FileType.RESOURCE]: ["images", "download"],
    }, file_names = {
        [FileType.ENCRYPT]: "EnMicroMsg",
        [FileType.DECRYPT]: "DeMicroMsg",
        [FileType.RESOURCE]: "data",
    }, file_labels = {
        [FileType.ENCRYPT]: _("Encryption database"),
        [FileType.DECRYPT]: _("Decryption database"),
        [FileType.RESOURCE]: _("Resource"),
    }, button_labels = {
        [FileType.ENCRYPT]: _("Pull database"),
        [FileType.DECRYPT]: _("Decrypt database"),
        [FileType.RESOURCE]: _("Pull resource"),
    }, button_cmds = {
        [FileType.ENCRYPT]: "pull_db",
        [FileType.DECRYPT]: "decrypt",
        [FileType.RESOURCE]: "pull_res",
    }, button_params = {
        [FileType.ENCRYPT]: {command: "pull_db", user: user},
        [FileType.DECRYPT]: {command: "decrypt", password: password},
        [FileType.RESOURCE]: {
            command: "pull_res",
            user: user,
            timeout: 1800,
        },
    }, button_status = { // disabled status
        [FileType.ENCRYPT]: false,
        [FileType.DECRYPT]: [BackupState.WAITING].includes(fsm.state),
        [FileType.RESOURCE]: [BackupState.WAITING, BackupState.DBPULLED].includes(fsm.state),
    };

    var item = cloneItemFromTemplate(projectName, type, ItemStatus.QUEUE, target);

    updateItemContent("name", projectName, type, ItemStatus.QUEUE, file_labels[type]);
    updateItemContent("action", projectName, type, ItemStatus.QUEUE, button_labels[type]);
    updateItemButtonStatus(fsm, type, ItemStatus.QUEUE);

    item.find("button")
        .on("click", function () {
            addTask({
                name: projectName,
                category: button_cmds[type],
                params: button_params[type],
            });
        });

    for (let icon of icons[type]) {
        item.find(".fa-" + icon).show();
    }

    item.on("mouseenter", function () {
        $(this).find(".item-action").stop().fadeIn(500, "swing");
    }).on("mouseleave", function () {
        $(this).find(".item-action").stop().fadeOut(500, "swing");
    });
}

/**
 * 设置进行中条目
 * @param fsm 备份状态机
 * @param type 文件类型
 * @param target 替换目标
 */
function setDoingItem(fsm, type, target) {
    var projectName = fsm.project.name;
    var password = fsm.project.password;
    var user = fsm.project.user;
    var file_names = {
        [FileType.ENCRYPT]: "EnMicroMsg",
        [FileType.DECRYPT]: "DeMicroMsg",
        [FileType.RESOURCE]: "data",
    }, file_labels = {
        [FileType.ENCRYPT]: _("Pulling database"),
        [FileType.DECRYPT]: _("Decrypting database"),
        [FileType.RESOURCE]: _("Pulling resource"),
    }, button_labels = {
        [FileType.ENCRYPT]: _("Stop"),
        [FileType.DECRYPT]: _("Stop"),
        [FileType.RESOURCE]: _("Stop"),
    }, button_status = { // disabled status
        [FileType.ENCRYPT]: false,
        [FileType.DECRYPT]: [BackupState.WAITING].includes(fsm.state),
        [FileType.RESOURCE]: [BackupState.WAITING, BackupState.DBPULLED].includes(fsm.state),
    };

    var item = cloneItemFromTemplate(projectName, type, ItemStatus.DOING, target);

    updateItemContent("name", projectName, type, ItemStatus.DOING, file_labels[type]);

    item.find("button")
        .prop("disabled", button_status[type])
        .on("click", function () {
            execCommand({
                name: projectName,
                command: "stop_task",
                params: {
                    type: type,
                },
            }, true);
        });

    item.on("mouseenter", function () {
        $(this).find(".list-doing-button").stop().fadeIn(500, "swing");
    }).on("mouseleave", function () {
        $(this).find(".list-doing-button").stop().fadeOut(500, "swing");
    });
}

/**
 * 切换在等候条目为进行中条目
 * @param fsm 备份状态机
 * @param type 文件类型
 */
function switchQueueToDoing(fsm, type) {
    var row = $("#item_queue_" + type + "_" + fsm.project.name);
    setDoingItem(fsm, type, row);
}

/**
 * 切换已完成条目为进行中条目
 * @param fsm 备份状态机
 * @param type 文件类型
 */
function switchDoneToDoing(fsm, type) {
    var row = $("#item_done_" + type + "_" + fsm.project.name);
    setDoingItem(fsm, type, row);
}

/**
 * 切换进行中条目为已完成条目
 * @param fsm 备份状态机
 * @param type 文件类型
 */
function switchDoingToDone(fsm, type) {
    var row = $("#item_doing_" + type + "_" + fsm.project.name);
    setDoneItem(fsm, type, row);
}

/**
 * 切换已完成条目为在等候条目
 * @param fsm 备份状态机
 * @param type 文件类型
 */
function switchDoneToQueue(fsm, type) {
    var row = $("#item_done_" + type + "_" + fsm.project.name);
    setQueueItem(fsm, type, row);
}

/**
 * 获取条目的状态
 * @param fsm 备份状态机
 * @param type 文件类型
 * @returns {*} 条目当前的状态
 */
function getItemStatus(fsm, type) {
    for (let status of [ItemStatus.QUEUE, ItemStatus.DOING, ItemStatus.DONE]) {
        var row = $("#item_" + status + "_" + type + "_" + fsm.project.name);
        if (row.length !== 0) {
            return status;
        }
    }
}

/**
 * 更新条目分段的内容
 * @param section 更新的分段
 * @param projectName 备份计划名称
 * @param type 条目类型
 * @param status 条目状态
 * @param content 内容
 */
function updateItemContent(section, projectName, type, status, content) {
    var container = $("#item_" + status + "_" + type + "_" + projectName);
    container.find(".item-" + section + " .status-label").text(content);
}

/**
 * 更新条目按钮禁用状态
 * @param fsm 备份状态机
 * @param type 文件类型
 * @param status 禁用状态
 */
function updateItemButtonStatus(fsm, type, status) {
    var isRoot = ["root-ready","input-ready"].includes(fsmDevice.state) ;
    var button_status = { // disabled status
        [FileType.ENCRYPT]: {
            [ItemStatus.QUEUE]: !isRoot || ![BackupState.WAITING].includes(fsm.state),
            [ItemStatus.DOING]: false,
            [ItemStatus.DONE]: fsm[type].byte === 0,
        },
        [FileType.DECRYPT]: {
            [ItemStatus.QUEUE]: !isRoot || ![BackupState.DBPULLED].includes(fsm.state),
            [ItemStatus.DOING]: false,
            [ItemStatus.DONE]: fsm[type].byte === 0,
        },
        [FileType.RESOURCE]: {
            [ItemStatus.QUEUE]: !isRoot || ![BackupState.DECRYPTED].includes(fsm.state),
            [ItemStatus.DOING]: false,
            [ItemStatus.DONE]: fsm[type].byte === 0,
        },
    };
    var container = $("#item_" + status + "_" + type + "_" + fsm.project.name);
    container.find("button").prop("disabled", button_status[type][status]);
}

/**
 * 更新单个项目的条目按钮禁用状态
 * @param fsm 备份状态机
 */
function updateProjectQueueButtonStatus(fsm) {
    for (let type of [FileType.ENCRYPT, FileType.DECRYPT, FileType.RESOURCE]) {
        updateItemButtonStatus(fsm, type, ItemStatus.QUEUE);
    }
}

/**
 * 更新所有项目的条目按钮禁用状态
 */
function updateAllProjectsQueueButtonStatus() {
    for (let projectName in backupFSM) {
        updateProjectQueueButtonStatus(backupFSM[projectName]);
    }
}

/**
 * 更新数据库拉取进度
 * @param fsm 备份状态机
 */
function updateDbPullProgress(fsm) {
    var total = fsm[FileType.ENCRYPT].byte,
        size = fsm[FileType.ENCRYPT].current;
    if (size === null) {
        return;
    }
    if (fsm[FileType.ENCRYPT].progress >= 1) { // finish
        if (fsm.can("finish-pull-db")) {
            fsm.finishPullDb();
        } else {
            switchDoingToDone(fsm, FileType.ENCRYPT);
        }
    } else if (fsm[FileType.ENCRYPT].progress > 0) { // pulling
        var progress = formatNum(fsm[FileType.ENCRYPT].progress * 100) + "%";
        sizeMB = formatNum(size / 1024 / 1024) + " MB",
            totalMB = formatNum(total / 1024 / 1024) + " MB";
        updateItemContent("name", fsm.project.name, FileType.ENCRYPT,
            ItemStatus.DOING, _("Pulling database") + " " + progress);
        updateItemContent("size", fsm.project.name, FileType.ENCRYPT,
            ItemStatus.DOING, sizeMB + " / " + totalMB);
        if (getItemStatus(fsm, FileType.ENCRYPT) !== ItemStatus.DOING) {
            switchDoneToDoing(fsm, FileType.ENCRYPT);
        }
    } else if (fsm[FileType.DECRYPT].progress < 0) { // error
        if (fsm.can("wait-pull-db")) {
            fsm.stopPullDb();
        }
        updateItemContent("name", fsm.project.name, FileType.ENCRYPT,
            ItemStatus.QUEUE, _("Encryption database") + " [" + _("Error") + "]");
    }
}

/**
 * 更新数据库解密进度
 * @param fsm 备份状态机
 */
function updateDecryptProgress(fsm) {
    if (fsm[FileType.DECRYPT].progress >= 1) { // finish
        if (fsm.can("finish-decrypt-db")) {
            fsm.finishDecryptDb();
        } else {
            switchDoingToDone(fsm, FileType.DECRYPT);
        }
    } else if (fsm[FileType.DECRYPT].progress > 0) { // decrypting
        var progress = formatNum(fsm[FileType.DECRYPT].progress * 100) + "%";
        updateItemContent("name", fsm.project.name, FileType.DECRYPT,
            ItemStatus.DOING, _("Decrypting database") + " " + progress);
        updateItemContent("size", fsm.project.name, FileType.DECRYPT,
            ItemStatus.DOING, fsm[FileType.DECRYPT].step);
        if (getItemStatus(fsm, FileType.DECRYPT) !== ItemStatus.DOING) {
            switchDoneToDoing(fsm, FileType.DECRYPT);
        }
    }
}

/**
 * 更新资源拉取进度
 * @param fsm 备份状态机
 */
function updateResourceProgress(fsm) {
    if (fsm[FileType.RESOURCE].step === 0) {
        // init
        updateItemContent("size", fsm.project.name, FileType.RESOURCE,
            ItemStatus.DOING, fsm[FileType.RESOURCE].step_name);
    } else if (fsm[FileType.RESOURCE].step < 0) {
        if (fsm[FileType.RESOURCE].progress >= 1) {
            // finish
            if (fsm.can("finish-pull-res")) {
                fsm.finishPullRes();
            } else {
                switchDoingToDone(fsm, FileType.RESOURCE);
            }
        } else {
            // timeout
            updateItemContent("name", fsm.project.name, FileType.RESOURCE,
                ItemStatus.DOING, fsm[FileType.RESOURCE].step_name);
            updateItemContent("size", fsm.project.name, FileType.RESOURCE,
                ItemStatus.DOING, "- / " + fsm[FileType.RESOURCE].size);
            killTask(fsm.project.name);
        }
    } else {
        // pulling
        var progress = formatNum(fsm[FileType.RESOURCE].progress * 100) + "%",
            currentMB = formatNum(fsm[FileType.RESOURCE].current / 1024 / 1024) + " MB";
        updateItemContent("name", fsm.project.name, FileType.RESOURCE,
            ItemStatus.DOING, fsm[FileType.RESOURCE].step_name + " " + progress);
        updateItemContent("size", fsm.project.name, FileType.RESOURCE,
            ItemStatus.DOING, currentMB + " / " + fsm[FileType.RESOURCE].size);
        if (getItemStatus(fsm, FileType.RESOURCE) !== ItemStatus.DOING) {
            switchDoneToDoing(fsm, FileType.RESOURCE);
        }
    }
}

/**
 * 删除文件
 * @param fsm 备份状态机
 * @param type 条目类型
 */
function deleteFile(fsm, type) {
    if (type === FileType.ENCRYPT) {
        if (fsm.can("delete-pulled-db")) {
            fsm.deletePulledDb();
        } else {
            fsm.clearFile(type);
        }
    } else if (type === FileType.DECRYPT) {
        if (fsm.can("delete-decrypted-db")) {
            fsm.deleteDecryptedDb();
        } else {
            fsm.clearFile(type);
        }
    } else if (type === FileType.RESOURCE) {
        if (fsm.can("delete-pulled-res")) {
            fsm.deletePulledRes();
        }
    }
}

/**
 * 解析已有备份计划
 * @param data 备份列表数据
 * @returns {[]}
 */
function parseExistProjects(data) {
    var projectList = [];
    var user, password;
    for (let projectName in data) {
        user = data[projectName].user;
        password = data[projectName].password;
        var fsm = new BackupStateMachine();
        fsm.initBackup(projectName, user, password);
        // if (fsmDevice.state === "root-ready"){
        fsm.goto(BackupState.WAITING);
        // }else{
        //     fsm.goto(BackupState.INIT);
        // }
        if (!projectList.includes(projectName)) {
            projectList.push(projectName);
        }
        for (let file of data[projectName].files) {
            var filename = file[0].replace(/^.*[\\\/]/, "");
            var filetype = filename.substr(0, 2);
            fsm.setFile(filetype, file[0], file[1]);
            var size = Number((file[1] / 1024 / 1024).toString()
                                                     .match(/^\d+(?:\.\d{0,2})?/)) + " MB";

            if (filetype === FileType.ENCRYPT && fsm.state === BackupState.WAITING) {
                fsm.goto(BackupState.DBPULLED);
            } else if (filetype === FileType.DECRYPT) {
                fsm.goto(BackupState.DECRYPTED);
            } else if (filetype === FileType.RESOURCE) {
                fsm.goto(BackupState.RESPULLED);
            }
        }
        backupFSM[projectName] = fsm;
    }
    projectList.sort(function (a, b) {return a < b ? -1 : 1;});
    return projectList;
}

/**
 * 获取已有备份计划
 */
function getExistProjects() {
    // execCommand({command: "get_exist_projects"}, true);
    addTask({
        name: encodeURI(_("Exist projects")),
        category: "once",
        params: {
            command: "get_exist_projects",
        },
    });
}

$(function () {
    $("#btn_project").on("click", createBackupProject);
});
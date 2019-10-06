/**
 * 执行控制命令
 * @param args 命令参数
 * @param notEvent 是否非自动处理的按钮事件
 */
function execCommand(args, notEvent) {
    if (isServerConnected(true)) {
        if (!notEvent) {
            args = {
                command: $(this).attr("data-command"),
                name: encodeURI($(this).text()),
                channel: "android",
                param: $(this).attr("data-source") === undefined
                    ? [] : $(this).attr("data-source").split("|"),
            };
            sendOutput(decodeURI(args.name) + _(" → Command execution started"), OutputType.STATUS);
        } else {
            args["channel"] = "android";
        }
        socketio.emit("exec_command", args, callback = execCommandCallback);
    }
}

/**
 * 执行控制命令的回调
 * @param command 命令代码
 * @param name 命令名称
 * @param success 命令是否已成功
 * @param data 返回的数据
 * @param message 返回的消息
 */
function execCommandCallback(command, name, success, data, message) {
    var isNoName = name === null || name === undefined || name === "";
    var isNoMessage = message === null || message === undefined || message === "";
    try {
        eval(camelize.prepended("onPreCommandResponse", command) + "(data)");
    } catch (e) {
        if (e instanceof ReferenceError) {
            // do nothing
        } else {
            sendOutput(e, OutputType.ERROR);
        }
    }
    isNoMessage ? null : sendOutput(message, success ? OutputType.STDOUT : OutputType.ERROR);
    try {
        eval(camelize.prepended("onPostCommandResponse", command) + "(data)");
    } catch (e) {
        if (e instanceof ReferenceError) {
            // do nothing
        } else {
            sendOutput(e, OutputType.ERROR);
        }
    }
    isNoName ? null : sendOutput(decodeURI(name) + _(" → Command execution completed"), OutputType.STATUS);
}


function onPreCommandResponseGetDeviceProperties(data) {
    var panel = $("#status_device").parent().find(".dropdown-menu");
    panel.empty();
    for (let key in DEVICE_INFOS[0]) {
        panel.append("<li class='dropdown-header d-flex text-left'>" +
            "<span class='col-3 text-nowrap'>{0}</span>".format(DEVICE_INFOS[1][key]) +
            "<span class='col-9 text-right text-nowrap'>{0}</span></li>".format(data[DEVICE_INFOS[0][key]]));
    }
    var deviceSerial = $("#status_device").attr("data-serial");
    panel.append("<li class='dropdown-header d-flex text-left'>" +
        "<span class='col-3 text-nowrap'>{0}</span>".format(_("Serial Number")) +
        "<span class='col-9 text-right text-nowrap'>{0}</span></li>".format(deviceSerial));
    updateStatusContent("device", "on",  _("{0} is connected").format(data["ro.product.model"]));
    updateDropdownValidity("device", true);
}

function onPreCommandResponseCheckInsecure(data) {
    var hasInstalled = data;
    var isSendOutput = $("#status_root").attr("data-remindonce") === "true";
    if (hasInstalled) {
        if (isSendOutput)
            sendOutput(_("Please check \"Enable insecure adbd\" in " +
                "adbd Insecure on your device"));
        updateDropdownValidity("root", false);
    } else {
        if (isSendOutput)
            sendOutput(_("If the device is already root, please click " +
                "the button in the drop-down menu in the root status " +
                "to install adbd Insecure"));
        updateDropdownValidity("root", true);
    }
    $("#status_root").attr("data-installed", hasInstalled)
                     .attr("data-remindonce", false);
}

function onPreCommandResponseGetUsers(data) {
    $("#user").empty();
    var placeholder_text = _("Please choice user...");
    var placeholder_color = "red";
    if (data.length > 1) {
        $("#user").append("<option></option>");
        for (let user of data) {
            $("#user").append(new Option(user, user));
        }
    } else if (data.length > 0) {
        $("#user").append("<option></option>");
        $("#user").append("<option value=\"" + data[0] + "\" selected>data[0]</option>");
    } else {
        $("#user").append("<option></option>");
        placeholder_text = _("User");
        placeholder_color = "lightgray";
    }
    $("#user").attr("data-placeholder", _(placeholder_text)).select2({
        minimumResultsForSearch: "Infinity",
        allowClear: true,
    });
    var style = $("head").find("style");
    style.text(style.text()
                    .replace(/(#s2id_user[^{]*{\s*color:\s*)(\S*)([^!]*![^}]*})/gm
                        , "$1" + placeholder_color + "$3"));
}

function onPreCommandResponseGetImei(data) {
    $("#imei").empty();
    var placeholder_text = _("Please choice IMEI...");
    var placeholder_color = "red";
    if (data.length > 1) {
        $("#imei").append("<option></option>");
        for (let imei of data) {
            $("#imei").append(new Option(imei, imei));
        }
    } else if (data.length > 0) {
        $("#imei").append("<option></option>");
        $("#imei").append("<option value=\"" + data[0] + "\" selected>" + data[0] + "</option>");
    } else {
        $("#imei").append("<option></option>");
        placeholder_text = "IMEI";
        placeholder_color = "lightgray";
    }
    $("#imei").attr("data-placeholder", _(placeholder_text)).select2({
        minimumResultsForSearch: "Infinity",
        allowClear: true,
    }).trigger("change");
    var style = $("head").find("style");
    style.text(style.text()
                    .replace(/(#s2id_imei[^{]*{\s*color:\s*)(\S*)([^!]*![^}]*})/gm
                        , "$1" + placeholder_color + "$3"));
}

function onPreCommandResponseGetUin(data) {
    if (data !== "") {
        $("#uin").val(data).trigger("change");
    }
}

function onPreCommandResponseDeleteFile(data) {
    if (data !== null) {
        var fsm = backupFSM[data.projectName];
        deleteFile(fsm, data.type);
    }
}

function onPreCommandResponseStopTask(data) {
    if (data) {
        var fsm = backupFSM[data.projectName];
        switchDoingToDone(fsm, data.type);
    }
}


const DEVICE_INFOS = [
    ["ro.product.manufacturer", "ro.product.model", "net.hostname"],
    [_("Manufacturer"), _("Model"), _("Host Name")]];

/**
 * 更新状态组件内容
 * @param id 组件ID
 * @param status 状态
 * @param content 内容
 */
function updateStatusContent(id, status, content) {
    $("#status_{0} .status-label-{1}".format(id, status)).text(content);
}

/**
 * 更新状态组件显示
 * @param id 组件ID
 * @param switchShow 是否切换到显示
 */
function updateStatusDisplay(id, switchShow) {
    switchShow ? $("#status_{0}".format(id)).show() : $("#status_{0}".format(id)).hide();
}

/**
 * 更新状态组件UI
 * @param id 组件ID
 * @param switchOn 是否切换到开启状态
 */
function updateStatusSwitch(id, switchOn) {
    var primaryWord = switchOn ? "on" : "off";
    var secondaryWord = switchOn ? "off" : "on";
    $("#status_{0} .status-icon".format(id))
        .removeClass("status-icon-{0}".format(secondaryWord))
        .addClass("status-icon-{0}".format(primaryWord));
    $("#status_{0} .status-label-{1}".format(id, primaryWord)).show();
    $("#status_{0} .status-label-{1}".format(id, secondaryWord)).hide();
}

/**
 * 更新下拉组件有效性
 * @param id 组件ID
 * @param switchValid 是否切换到有效
 */
function updateDropdownValidity(id, switchValid) {
    var primaryWord = switchValid ? "dropdown" : "_dropdown_";
    var secondaryWord = switchValid ? "_dropdown_" : "dropdown";
    $("#status_{0}".format(id)).attr("data-toggle", primaryWord);
    $("#status_{0}".format(id)).parent()
                               .removeClass(secondaryWord)
                               .addClass(primaryWord);
}

/**
 * 更新按钮组件UI
 * @param id 组件ID
 * @param switchEnable 是否切换到启用状态
 */
function updateButtonEnabled(id, switchEnable) {
    $("#btn_{0}".format(id)).prop("disabled", !switchEnable);
}

/**
 * 加入信道
 */
function joinServerChannel() {
    socketio.emit("join", {
        "channel": "android",
        "sid": socketio.id,
    });
}

/**
 * 离开信道
 */
function leaveServerChannel() {
    socketio.emit("leave", {
        "channel": "android",
        "sid": socketio.id,
    });
}

/**
 * 启动设备检查器
 */
function startupDeviceChecker() {
    addTask({
        name: encodeURI(_("Device checker")),
        category: "heartbeat",
        params: {
            command: "check_device",
            interval: 3,
        },
    });
}

/**
 * 停止设备检查器
 */
function stopDeviceChecker() {
    killTask(encodeURI(_("Device checker")));
}

/**
 * 启动Root检查器
 */
function startupRootChecker() {
    addTask({
        name: encodeURI(_("Root checker")),
        category: "heartbeat",
        params: {
            command: "check_root",
            interval: 3 ,
        },
    });
}

/**
 * 停止Root检查器
 */
function stopRootChecker() {
    killTask(encodeURI(_("Root checker")));
}

/**
 * 校验输入完整的条件
 */
function verifyComplementInputConditions() {
    /**
     * 试算密码
     */
    function trialPassword() {
        var imei = $("#imei").val();
        var uin = $("#uin").val();
        var password_old = $("#password").val();
        if (imei !== "" && uin !== "") {
            var password = CryptoJS.MD5(imei + uin).toString().substr(0, 7);
            if (password !== password_old) {
                $("#password").val(password);
                sendOutput(_("Calculated password: ") + password, OutputType.STDOUT);
            }
        } else {
            $("#password").val("");
        }
        $("#btn_project").attr("data-user", $("#user").val())
                         .attr("data-password", $("#password").val())
                         .attr("data-source", $("#btn_project").attr("data-project")
                             + "|" + $("#btn_project").attr("data-user")
                             + "|" + $("#btn_project").attr("data-password"));
    }

    setTimeout(function () {
        trialPassword();

        if (($("#password").val() === "" || $("#user").val() === "")
            && fsmDevice.can("reset-input")) {
            fsmDevice.resetInput();
        } else if ($("#password").val() !== "" && $("#user").val() !== ""
            && fsmDevice.can("complement-input")) {
            fsmDevice.complementInput();
        }
    }, 100);
}

// 设备状态机
var fsmDevice = new StateMachine({
    init: "init",
    transitions: [
        {
            name: "connect-server",
            from: "init",
            to: "server-ready",
        },
        {
            name: "disconnect-server",
            from: "*",
            to: "init",
        },
        {
            name: "connect-device",
            from: "server-ready",
            to: "device-ready",
        },
        {
            name: "disconnect-device",
            from: ["device-ready", "root-ready", "input-ready"],
            to: "server-ready",
        },
        {
            name: "access-root",
            from: "device-ready",
            to: "root-ready",
        },
        {
            name: "deny-root",
            from: ["root-ready", "input-ready"],
            to: "device-ready",
        },
        {
            name: "complement-input",
            from: "root-ready",
            to: "input-ready",
        },
        {
            name: "reset-input",
            from: "input-ready",
            to: "root-ready",
        },
    ],
    methods: {
        onBeforeCloseServerConnection: function(){ // 服务器连接关闭前由关闭动作负责触发
            if (["device-ready","root-ready"].includes(this.state)){
                stopRootChecker();
            }
            if (["server-ready","device-ready","root-ready"].includes(this.state)){
                stopDeviceChecker();
            }
        },
        onEnterState: function (lifecycle) {
            sendFootInfo(lifecycle);
        },
        onEnterInit: function (lifecycle) {
            sendFootInfo(lifecycle);
            updateStatusDisplay("root", false);
            updateStatusSwitch("server", false);
            updateStatusSwitch("device", false);
            updateStatusSwitch("root", false);
            updateButtonEnabled("disconnect", false);
            updateButtonEnabled("reconnect", true);
            updateButtonEnabled("imei", false);
            updateButtonEnabled("uin", false);
            updateButtonEnabled("user", false);
            updateDropdownValidity("device", false);
        },
        onEnterServerReady: function (lifecycle) {
            sendFootInfo(lifecycle);
            updateStatusSwitch("server", true);
            updateButtonEnabled("disconnect", true);
            updateButtonEnabled("reconnect", false);
        },
        onAfterConnectServer: function (lifecycle) {
            sendFootInfo(lifecycle);
            sendOutput(_("Server is connected"), OutputType.SUCCESS);
            joinServerChannel();
            startupDeviceChecker();
            getExistProjects();
        },
        onBeforeDisconnectServer: function (lifecycle) {
            if (["root-ready", "device-ready"].includes(this.state)) {
                this.onBeforeDisconnectDevice(lifecycle);
            }
            sendFootInfo(lifecycle);
            updateProjectBrowserDisplay(false);
            sendOutput(_("Server has been disconnected"), OutputType.ERROR);
        },
        onEnterDeviceReady: function (lifecycle) {
            sendFootInfo(lifecycle);
            updateStatusSwitch("device", true);
            updateDropdownValidity("device", true);
        },
        onAfterConnectDevice: function (lifecycle) {
            sendFootInfo(lifecycle);
            startupRootChecker();
            updateStatusDisplay("root", true);
            sendOutput(_("Device is connected"), OutputType.SUCCESS);
        },
        onBeforeDisconnectDevice: function (lifecycle) {
            if (["root-ready", "device-ready"].includes(this.state)) {
                this.onBeforeDenyRoot(lifecycle);
            }
            sendFootInfo(lifecycle);
            updateStatusSwitch("device", false);
            updateDropdownValidity("device", false);
            stopRootChecker();
            sendOutput(_("Device has been disconnected"), OutputType.ERROR);
        },
        onEnterRootReady: function (lifecycle) {
            sendFootInfo(lifecycle);
            updateStatusSwitch("root", true);
            updateButtonEnabled("imei", true);
            updateButtonEnabled("uin", true);
            updateButtonEnabled("user", true);
            verifyComplementInputConditions();
        },
        onAfterAccessRoot: function (lifecycle) {
            sendFootInfo(lifecycle);
            updateAllProjectsQueueButtonStatus();
        },
        onBeforeDenyRoot: function (lifecycle) {
            sendFootInfo(lifecycle);
            updateStatusSwitch("root", false);
            updateButtonEnabled("imei", false);
            updateButtonEnabled("uin", false);
            updateButtonEnabled("user", false);
            updateStatusDisplay("root", false);
        },
        onAfterDenyRoot: function (lifecycle) {
            sendFootInfo(lifecycle);
            updateAllProjectsQueueButtonStatus();
        },
        onEnterInputReady: function (lifecycle) {
            sendFootInfo(lifecycle);
        },
        onAfterComplementInput: function (lifecycle) {
            updateButtonEnabled("project", true);
        },
        onAfterResetInput: function (lifecycle) {
            sendFootInfo(lifecycle);
        },
    },
});

$(function () {
    $("head").append("<style>#s2id_imei .select2-default {color: lightgray !important;}" +
        "#s2id_user .select2-default {color: lightgray !important;}</style>");

    // 控制命令
    $(".btn-controller").on("click", execCommand);
    // IMEI与UIN输入校验
    [$("#imei").select2(), $("#uin"), $("#user").select2()].forEach(function () {
        $(this).on("change paste keyup", function () {verifyComplementInputConditions();});
    });
});
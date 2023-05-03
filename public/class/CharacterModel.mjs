import {EventEmitter} from "./EventEmitter.mjs";
import {token, requestTimeout, characterAddedSign} from "../script.js";
import {CharacterView} from "./CharacterView.mjs";

export class CharacterModel extends EventEmitter {
    static EVENT_WIPE_CHAT = "clear_chat";
    static EVENT_ERROR = "error";

    static dragged;
    static activeFolder;

    /**  data structure
     * interface IFolderDatum = {
     *      children?: IFolderDatum[],
     *      name: string,
     *      id?: number, (for images)
     *      folder: boolean
     */
    data = {};
    characters = [];
    selectedID;
    view;

    constructor(options) {
        super();

        this.view = new CharacterView({
            parent: this,
            container: options.container,
            input: options.input || {},
        });
        this.view.on(CharacterView.EVENT_CHARACTER_SELECT, this.onCharacterSelect.bind(this));
        this.view.on(CharacterView.EVENT_CHARACTER_DELETE, this.onCharacterDelete.bind(this));
        this.view.on(CharacterView.EVENT_FILES_IMPORT, this.onFilesImport.bind(this));
        this.view.on(CharacterView.EVENT_SAVE_FOLDERS, this.onSaveFolders.bind(this));
    }

    get id() {
        return this.characters;
    }

    // event handlers
    onCharacterSelect(event) {
        this.selectedID = this.getIDbyFilename(event.target);
        this.emit(CharacterView.EVENT_CHARACTER_SELECT, event);
    }

    onCharacterDelete(event) {
        let id = this.getIDbyFilename(event.target);
        jQuery.ajax({
            method: 'POST',
            url: '/deletecharacter',
            beforeSend: function(){},
            data: JSON.stringify({
                filename: event.target
            }),
            cache: false,
            dataType: "json",
            contentType: "application/json",
            processData: false,
            success: function(html){
                this.characters = this.characters.filter(
                    ch => ch.filename != event.target
                );
                if(this.selectedID == id) {
                    this.selectedID = null;
                    this.emit(CharacterModel.EVENT_WIPE_CHAT, {});
                    document.getElementById("chat_header_back_button").click();
                }
                this.saveFolders();
            }.bind(this)
        });
    }

    onFilesImport(event) {
        if(event.files.length == 1) {
            this.importCharacter(event.files[0]).then(char => {
                characterAddedSign(char.name, 'Character imported');
            }, error => {
                document.getElementById("create_button").removeAttribute("disabled");
            });
            return;
        }

        this.importCharacters(event.files).then(resolve => {
            if(event.type === CharacterView.EVENT_FILES_TYPE.FORM) {
                if(resolve.failures.length) {
                    console.error("Failure to load " + resolve.failures.length + "/" + (resolve.successes.length+resolve.failures.length) + " files");
                    characterAddedSign(null, resolve.successes.length + "/" + (resolve.successes.length+resolve.failures.length) + " characters imported");
                } else {
                    characterAddedSign(null, resolve.successes.length + " characters imported");
                }
            }
        }, reject => {});
    }
    onSaveFolders(event) {
        this.saveFolders();
    }

    // loading
    loadAll() {
        return new Promise((resolve, reject) => {
            this.loadCharacters().then(characters => {
                this.loadFolders().then(folders => {
                    this.characters = Object.values(characters);
                    this.view.refresh(folders, this.characters);
                }, () => {});
            }, error => {
                reject(error);
            });
        });
    }

    loadCharacters(filename) {
        return new Promise((resolve, reject) => {
            jQuery.ajax({
                type: 'POST', //
                url: '/getcharacters',
                beforeSend: function () {},
                cache: false,
                dataType: "json",
                data: filename ? JSON.stringify({ filename: filename }) : JSON.stringify({ }),
                contentType: "application/json",
                headers: {
                    "X-CSRF-Token": token
                },
                success: function(data) {
                    resolve(data);
                }.bind(this),
                error: function (jqXHR, exception) {
                    reject(this.handleError(jqXHR));
                }.bind(this)
            })
        });
    }

    loadFolders() {
        return new Promise((resolve, reject) => {
            jQuery.ajax({
                type: 'POST',
                url: '/loadfolders',
                data: null,
                beforeSend: function(){},
                cache: false,
                dataType: "json",
                contentType: "application/json",
                headers: {
                    "X-CSRF-Token": token
                },
                success: function(data){
                    resolve(data);
                }.bind(this),
                error: function (jqXHR, exception) {
                    console.warn("Could not load folders. Defaulting to none.");
                    resolve();
                }.bind(this)
            });
        });
    }

    // saving
    saveFolders() {
        return new Promise((resolve, reject) => {
            let data = this.view.getSimple();
            jQuery.ajax({
                type: 'POST',
                url: '/savefolders',
                data: JSON.stringify(data),
                beforeSend: function(){},
                cache: false,
                dataType: "json",
                contentType: "application/json",
                headers: {
                    "X-CSRF-Token": token
                },
                success: function(){
                    resolve();
                },
                error: function (jqXHR, exception) {
                    console.error(jqXHR);
                    console.error(exception);
                    reject(jqXHR, exception);
                }
            });
        });
    }

    // error handler
    handleError(jqXHR) {
        let msg;
        let status;
        try {
            let msg_json = JSON.parse(jqXHR.responseText);
            msg = msg_json.error;
            if(msg.error !== undefined){
                msg = msg.error;
            }
        } catch {
            msg = 'Unique error';
        }
        if(jqXHR.status !== undefined){
            status = jqXHR.status;
        }else{
            status = 400;
        }
        if(status === 504){
            msg = 'Server is not responding';
        }
        if(status === 429){
            msg = 'Too many requests';
        }
        console.log(`Status: ${status}`);
        console.log(msg);
        this.emit(CharacterModel.EVENT_ERROR, { status: status, message: msg });
        return {'status': status, 'msg':msg};
    }

    // lookup
    getIDbyFilename(filename){
        return this.characters.findIndex(char => char.filename === filename);
    }
    getIDbyPublicID(public_id){
        return this.characters.findIndex(char => char.public_id === public_id);
    }

    // import
    importCharacters(files, strict = false, successes = [], failures = []) {
        return new Promise((resolve, reject) => {
            this.importCharacter(files.shift())
                .then(success => {
                    successes.push(success);
                    if(files.length) {
                        this.importCharacters(files, strict, successes, failures).then(resolve, reject);
                    } else {
                        return resolve({ successes, failures });
                    }
                }, failure => {
                    failures.push(failure);
                    if(strict) {
                        return reject({ successes, failures });
                    }
                    if(files.length) {
                        this.importCharacters(files, strict, successes, failures).then(resolve, reject);
                    } else {
                        return resolve({ successes, failures });
                    }
                })
        });
    }

    importCharacter(file) {
        return new Promise((resolve, reject) => {
            if(!file) { return reject("No file given."); }

            let filename = file.name.replace(/\.[^\.]*/, "");
            let filetype = file.type.replace(/.*\//, "");

            if(this.characters.filter(char =>
                char.filename.replace(/\.[^\.]*/, "").toLowerCase() === filename.toLowerCase()
            ).length) {
                return reject("File already exists");
            }

            var formData = new FormData();
            formData.append("avatar", file, file.name);
            formData.append("file_type", filetype);

            jQuery.ajax({
                type: 'POST',
                url: '/importcharacter',
                data: formData,
                beforeSend: function() {},
                cache: false,
                timeout: requestTimeout,
                contentType: false,
                processData: false,
                success: function(data){
                    if(data.file_name !== undefined){
                        this.loadCharacters(data.file_name.replace(/\.[^\.]*/, "")).then(data => {
                            if(data && data[0]) {
                                this.characters.push(data[0]);
                                let char = this.view.addCharacter(data[0]);
                                this.saveFolders();
                                resolve(char);
                            } else {
                                reject("Unknown error");
                            }
                        });
                    }
                }.bind(this),
                error: function (jqXHR, exception) {
                    console.error(jqXHR);
                    console.error(exception);
                    reject(jqXHR);
                }
            });
        });
    }
}


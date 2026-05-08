import { h, render, Component } from 'preact';
import KeyboardShortcuts from './KeyboardShortcuts.jsx';
import { bindPlayerToUI, keyboardShortcutSetup, syncTimestampOffsetUI } from '../ui';
import { getSettings, defaultSettings, localStorageManager } from './store';

const refreshApp = {};
refreshApp.keyboardShortcuts = (state, prevState) => {
    bindPlayerToUI();
    keyboardShortcutSetup();
    // TODO: check if any keyboard shortcuts are no longer present in current state
    const shortcuts = state.keyboardShortcuts.shortcuts;
    const prevShortcuts = prevState.keyboardShortcuts.shortcuts;
}
refreshApp.timestampOffsets = () => {
    bindPlayerToUI();
    syncTimestampOffsetUI();
}

function TimestampOffsetSettings(props) {
    const update = function(ev) {
        const seconds = parseFloat(ev.target.value);
        props.onChange({
            previousTimestamp: isNaN(seconds) ? defaultSettings.timestampOffsets.previousTimestamp : Math.max(0, seconds)
        });
    };

    return (
        <div className="timestamp-offset-settings">
            <h3>{document.webL10n.get('timestamp-offsets')}</h3>
            <label className="timestamp-offset-field">
                <span>{document.webL10n.get('addTimestampPreviousSecond')}</span>
                <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={props.settings.previousTimestamp}
                    onInput={update}
                    onChange={update}
                />
                <span>{document.webL10n.get('seconds')}</span>
            </label>
            <div className="reset-button" onClick={props.reset}>
                {document.webL10n.get('restore-timestamp-offsets')}
            </div>
        </div>
    );
}

class Settings extends Component {
    constructor(props) {
        super(props);
        this.state = getSettings();
    }
    componentDidUpdate(prevProps, prevState) {
        localStorageManager.setItem('oTranscribe-settings', this.state);
        Object.keys(refreshApp).forEach(key => {
            if (this.state[key] !== prevState[key]) {
                refreshApp[key](this.state, prevState);
            }
        });
    }
    render() {
        const update = function(key, value) {
            this.setState({
                [key]: Object.assign({}, value)
            });
        }
        const reset = function(key) {
            this.setState({
                [key]: defaultSettings[key]
            });
        }
        return (
            <div>
                <h2 class="panel-title">Settings</h2>
                <KeyboardShortcuts
                    settings={this.state.keyboardShortcuts}
                    reset={reset.bind(this, 'keyboardShortcuts')}
                    onChange={update.bind(this, 'keyboardShortcuts')}
                />
                <TimestampOffsetSettings
                    settings={this.state.timestampOffsets}
                    reset={reset.bind(this, 'timestampOffsets')}
                    onChange={update.bind(this, 'timestampOffsets')}
                />
            </div>
        );
    }
}
export { getSettings };
export function showSettings(el) {
    render(<Settings />, el);    
}

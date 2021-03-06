/**
 * Based in part on Filipe Vieira'a ITG3200 library for Arduino.
 *
 * Copyright (c) 2011-2012 Jeff Hoefs <soundanalogous@gmail.com>
 * Released under the MIT license. See LICENSE file for details.
 */

JSUTILS.namespace('BO.io.GyroITG3200');

BO.io.GyroITG3200 = (function () {
    "use strict";

    var GyroITG3200;

    // private static constants
    var STARTUP_DELAY = 70,
        SMPLRT_DIV = 0x15,
        DLPF_FS = 0x16,
        INT_CFG = 0x17,
        GYRO_XOUT = 0x1D,
        GYRO_YOUT = 0x1F,
        GYRO_ZOUT = 0x21,
        PWR_MGM = 0x3E,
        NUM_BYTES = 6;

    // dependencies
    var I2CBase = BO.I2CBase,
        Event = JSUTILS.Event,
        GyroEvent = BO.io.GyroEvent;

    /**
     * Creates an interface to an ITG3200 3-axis gyroscope. This gyro measures
     * angular acceleration around the x, y, and z axis. This object provides
     * the angular velocity of each axis. Proper calibration is required for an
     * accurate reading. See [Breakout/examples/sensors/itg3200.html](https://github.com/soundanalogous/Breakout/blob/master/examples/sensors/itg3200.html) and 
     * [Breakout/examples/processing\_js/gyro.html](https://github.com/soundanalogous/Breakout/blob/master/examples/processing_js/gyro.html) for example applications.
     *
     * @class GyroITG3200
     * @constructor
     * @extends BO.I2CBase
     * @param {IOBoard} board The IOBoard instance
     * @param {Boolean} autoStart True if read continuous mode should start automatically upon instantiation (default is true)
     * @param {Number} address The i2c address of the accelerometer. If pin 9 (AD0) of the module is tied to VDD, then use
     * `GyroITG3200.ID_AD0_DVV` (0x69), if pin 9 (AD0) is tied to GND, then use `GyroITG3200.ID_AD0_GND`. 
     * Default = `GyroITG3200.ID_AD0_VDD`
     */
    GyroITG3200 = function (board, autoStart, address) {

        if (autoStart === undefined) {
            autoStart = true;
        }
        address = address || GyroITG3200.ID_AD0_VDD;
        
        I2CBase.call(this, board, address);

        this.name = "GyroITG3200";

        // private properties
        this._autoStart = autoStart;
        this._isReading = false;
        this._tempOffsets = {};
        this._startupTimer = null;
        this._debugMode = BO.enableDebugging;
        
        this._x = 0;
        this._y = 0;
        this._z = 0;

        this._gains = {x: 1.0, y: 1.0, z: 1.0};
        this._offsets = {x: 0.0, y: 0.0, z: 0.0};
        this._polarities = {x: 0, y: 0, z: 0};

        this.setRevPolarity(false, false, false);

        this.init();

    };

    GyroITG3200.prototype = JSUTILS.inherit(I2CBase.prototype);
    GyroITG3200.prototype.constructor = GyroITG3200;


    Object.defineProperties(GyroITG3200.prototype, {
        /**
         * [read-only] The x axis output value in degrees.
         * @property x
         * @type Number
         */
        x: {
            get: function () {
                return this._x / 14.375 * this._polarities.x * this._gains.x + this._offsets.x;
            }
        },

        /**
         * [read-only] The y axis output value in degrees.
         * @property y
         * @type Number
         */
        y: {
            get: function () {
                return this._y / 14.375 * this._polarities.y * this._gains.y + this._offsets.y;
            }
        },

        /**
         * [read-only] The z axis output value in degrees.
         * @property z
         * @type Number
         */
        z: {
            get: function () {
                return this._z / 14.375 * this._polarities.z * this._gains.z + this._offsets.z;
            }
        },

        /**
         * [read-only] The raw value of the x axis
         * @property rawX
         * @type Number
         */
        rawX: {
            get: function () {
                return this._rawX;
            }
        },

        /**
         * [read-only] The raw value of the y axis
         * @property rawY
         * @type Number
         */
        rawY: {
            get: function () {
                return this._rawY;
            }
        },

        /**
         * [read-only] The raw value of the z axis
         * @property rawZ
         * @type Number
         */
        rawZ: {
            get: function () {
                return this._rawZ;
            }
        },

        /**
         * [read-only] The state of continuous read mode. True if continuous read mode
         * is enabled, false if it is disabled.
         * @property isRunning
         * @type Boolean
         */
        isRunning: {
            get: function () {
                return this._isReading;
            }
        }
    });
    
    /**
     * Set the polarity of the x, y, and z output values.
     *
     * @method setRevPolarity
     * @param {Boolean} xPol Polarity of the x axis
     * @param {Boolean} yPol Polarity of the y axis
     * @param {Boolean} zPol Polarity of the z axis
     */
    GyroITG3200.prototype.setRevPolarity = function (xPol, yPol, zPol) {
        this._polarities.x = xPol ? -1 : 1;
        this._polarities.y = yPol ? -1 : 1;
        this._polarities.z = zPol ? -1 : 1;
    };
    
    /**
     * Offset the x, y, or z output by the respective input value.
     *
     * @method setOffsets
     * @param {Number} xOffset
     * @param {Number} yOffset
     * @param {Number} zOffset
     */
    GyroITG3200.prototype.setOffsets = function (xOffset, yOffset, zOffset) {
        this._offsets.x = xOffset;
        this._offsets.y = yOffset;
        this._offsets.z = zOffset;
    };
    
    /**
     * Set the gain value for the x, y, or z output.
     *
     * @method setGains
     * @param {Number} xGain
     * @param {Number} yGain
     * @param {Number} zGain
     */
    GyroITG3200.prototype.setGains = function (xGain, yGain, zGain) {
        this._gains.x = xGain;
        this._gains.y = yGain;
        this._gains.z = zGain;
    };

    /**
     * Start continuous reading of the sensor.
     * @method startReading
     */
    GyroITG3200.prototype.startReading = function () {
        if (!this._isReading) {
            this._isReading = true;
            this.sendI2CRequest([I2CBase.READ_CONTINUOUS, this.address, GYRO_XOUT, NUM_BYTES]);
        }
    };
    
    /**
     * Stop continuous reading of the sensor.
     * @method stopReading
     */
    GyroITG3200.prototype.stopReading = function () {
        this._isReading = false;
        this.sendI2CRequest([I2CBase.STOP_READING, this.address]);
    };


    /** 
     * Sends read request to accelerometer and updates accelerometer values.
     * @method update
     */
    GyroITG3200.prototype.update = function () {

        if (this._isReading) {
            this.stopReading();
        }
        // read data: contents of X, Y, and Z registers
        this.sendI2CRequest([I2CBase.READ, this.address, GYRO_XOUT, NUM_BYTES]);
    };

    /**
     * @private
     * @method init
     */
    GyroITG3200.prototype.init = function () {
        // set fast sample rate divisor = 0
        this.sendI2CRequest([I2CBase.WRITE, this.address, SMPLRT_DIV, 0x00]);
        
        // set range to +-2000 degrees/sec and low pass filter bandwidth to 256Hz and internal sample rate to 8kHz
        this.sendI2CRequest([I2CBase.WRITE, this.address, DLPF_FS, 0x18]);
        
        // use internal oscillator
        this.sendI2CRequest([I2CBase.WRITE, this.address, PWR_MGM, 0x00]);
        
        // enable ITG ready bit and raw data ready bit
        // note: this is probably not necessary if interrupts aren't used
        this.sendI2CRequest([I2CBase.WRITE, this.address, INT_CFG, 0x05]);
        

        this._startupTimer = setTimeout(this.onGyroReady.bind(this), STARTUP_DELAY);
    };

    /**
     * @private
     * @method onGyroReady
     */
    GyroITG3200.prototype.onGyroReady = function () {
        this._startupTimer = null;

        this.dispatchEvent(new GyroEvent(GyroEvent.GYRO_READY));
        if (this._autoStart) {
            this.startReading();
        }
    };

    /**
     * @private
     * @method setRegisterBit
     */
    GyroITG3200.prototype.setRegisterBit = function (regAddress, bitPos, state) {
        var value;
        
        if (state) {
            value |= (1 << bitPos);
        } else {
            value &= ~(1 << bitPos);
        }
        this.sendI2CRequest([I2CBase.WRITE, this.address, regAddress, value]);
    };


    /**
     * @private
     * @method handleI2C
     */
    GyroITG3200.prototype.handleI2C = function (data) {

        switch (data[0]) {
        case GYRO_XOUT:
            this.readGyro(data);
            break;
        default:
            this.debug("Got unexpected register data");
            break;
        }
    };

    /**
     * @private
     * @method readGyro
     */
    GyroITG3200.prototype.readGyro = function (data) {
        
        var x_val,
            y_val,
            z_val;
        
        if (data.length != NUM_BYTES + 1) {
            throw new Error("Incorrecte number of bytes returned");
        }
        
        x_val = (data[1] << 8) | (data[2]);
        y_val = (data[3] << 8) | (data[4]);
        z_val = (data[5] << 8) | (data[6]);
        
        if (x_val >> 15) {
            this._x = ((x_val ^ 0xFFFF) + 1) * -1;
        } else {
            this._x = x_val;
        }
        if (y_val >> 15) {
            this._y = ((y_val ^ 0xFFFF) + 1) * -1;
        } else {
            this._y = y_val;
        }
        if (z_val >> 15) {
            this._z = ((z_val ^ 0xFFFF) + 1) * -1;
        } else {
            this._z = z_val;
        }
        
        this.dispatchEvent(new GyroEvent(GyroEvent.UPDATE));
    };
    
    /**
     * for debugging
     * @private
     */
    GyroITG3200.prototype.debug = function (str) {
        if (this._debugMode) {
            console.log(str);
        }
    };
        
    // public static constants

    /** 
     * ID = 0x69 if sensor pin 9 (AD0) is tied to Power.
     * @property GyroITG3200.ID_AD0_VDD
     * @static
     */
    GyroITG3200.ID_AD0_VDD = 0x69;

    /** 
     * ID = 0x68 if sensor pin 9 (AD0) is tied to Ground.
     * @property GyroITG3200.ID_AD0_VDD
     * @static
     */
    GyroITG3200.ID_AD0_GND = 0x68;


    // document events

    /**
     * The update event is dispatched when the accelerometer values are updated.
     * @type BO.io.GyroEvent.UPDATE
     * @event update
     * @param {BO.io.GyroITG3200} target A reference to the GyroITG3200 object.
     */
            
    return GyroITG3200;

}());